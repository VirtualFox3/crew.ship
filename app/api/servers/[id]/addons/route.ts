import { agentFetch } from "@/lib/agent";
import { ApiError, handler, logEvent, ok, readJson, serverContext } from "@/lib/api";
import {
  resolveHangarVersion,
  resolveModrinthVersion,
  resolveSpigotVersion,
  type ResolvedVersion,
} from "@/lib/catalog";
import { loaderFor, softwareInfo } from "@/lib/software";
import { firstIssue, installAddonSchema } from "@/lib/validation";
import type { AddonKind, ServerAddon } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  const { data, error } = await ctx.supabase
    .from("server_addons")
    .select("*")
    .eq("server_id", id)
    .order("installed_at", { ascending: false });

  if (error) throw new ApiError(error.message, 500);
  return ok({ addons: (data as ServerAddon[]) ?? [] });
});

/**
 * Installs a plugin, mod, datapack or modpack.
 *
 * There is deliberately no cap on how many add-ons a server may hold. Required
 * dependencies are resolved and installed alongside the requested project so a
 * one-click install actually boots.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });

  const parsed = installAddonSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));
  const input = parsed.data;

  const info = softwareInfo(ctx.server.software);
  if (input.kind === "plugin" && !info.supports.plugins) {
    throw new ApiError(
      `${info.name} does not load plugins. Switch to Paper or Purpur, or install a mod instead.`,
    );
  }
  if (input.kind === "mod" && !info.supports.mods) {
    throw new ApiError(
      `${info.name} does not load mods. Switch to Fabric, Forge, NeoForge or Quilt.`,
    );
  }

  const loader = loaderFor(ctx.server.software);
  const resolved = await resolveFor(input, loader, ctx.server.version);
  if (!resolved) {
    throw new ApiError(
      "No compatible build exists for this Minecraft version yet.",
      404,
    );
  }

  const installed: ServerAddon[] = [];

  // Hard dependencies first — a plugin whose library is missing just crashes.
  const dependencies =
    input.source === "modrinth" ? resolved.dependencies.slice(0, 10) : [];

  for (const depId of dependencies) {
    const dep = await resolveModrinthVersion(depId, loader, ctx.server.version);
    if (!dep) continue;
    const row = await install(ctx, {
      kind: input.kind,
      source: "modrinth",
      projectId: depId,
      name: dep.filename.replace(/\.jar$/i, ""),
      resolved: dep,
      dir: info.addonDir,
    });
    if (row) installed.push(row);
  }

  const primary = await install(ctx, {
    kind: input.kind,
    source: input.source,
    projectId: input.projectId,
    name: input.name,
    slug: input.slug,
    author: input.author,
    iconUrl: input.iconUrl ?? null,
    resolved,
    dir: info.addonDir,
  });
  if (primary) installed.push(primary);

  await logEvent(ctx.admin, id, ctx.user.id, "addon.install", input.name);

  return ok(
    {
      installed,
      dependencies: dependencies.length,
      restartRequired: ctx.server.status === "online",
    },
    201,
  );
});

export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });

  const addonId = new URL(request.url).searchParams.get("addon");
  if (!addonId) throw new ApiError("Missing addon id.");

  const { data: addon } = await ctx.supabase
    .from("server_addons")
    .select("*")
    .eq("id", addonId)
    .eq("server_id", id)
    .maybeSingle();

  if (!addon) throw new ApiError("Add-on not found.", 404);

  if (ctx.node) {
    await agentFetch(ctx.node, `/servers/${id}/files`, {
      method: "DELETE",
      body: { path: `${softwareInfo(ctx.server.software).addonDir}/${addon.filename}` },
    }).catch(() => {
      // File already gone; still drop the row so the list stays truthful.
    });
  }

  await ctx.supabase.from("server_addons").delete().eq("id", addonId);
  await logEvent(ctx.admin, id, ctx.user.id, "addon.remove", addon.name);

  return ok({ removed: true, restartRequired: ctx.server.status === "online" });
});

/** Enable/disable without uninstalling — the agent renames to `.jar.disabled`. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });

  const body = await readJson<{ addon?: string; enabled?: boolean }>(request);
  if (!body.addon || typeof body.enabled !== "boolean") {
    throw new ApiError("Expected { addon, enabled }.");
  }

  const { data: addon } = await ctx.supabase
    .from("server_addons")
    .select("*")
    .eq("id", body.addon)
    .eq("server_id", id)
    .maybeSingle();

  if (!addon) throw new ApiError("Add-on not found.", 404);

  if (ctx.node) {
    await agentFetch(ctx.node, `/servers/${id}/addons/toggle`, {
      method: "POST",
      body: {
        dir: softwareInfo(ctx.server.software).addonDir,
        filename: addon.filename,
        enabled: body.enabled,
      },
    }).catch(() => {});
  }

  await ctx.supabase
    .from("server_addons")
    .update({ enabled: body.enabled })
    .eq("id", body.addon);

  return ok({ enabled: body.enabled, restartRequired: ctx.server.status === "online" });
});

// ---------------------------------------------------------------------------

async function resolveFor(
  input: { source: string; projectId: string; name: string; url?: string },
  loader: string,
  gameVersion: string,
): Promise<ResolvedVersion | null> {
  switch (input.source) {
    case "modrinth":
      return resolveModrinthVersion(input.projectId, loader, gameVersion);
    case "hangar":
      return resolveHangarVersion(input.projectId);
    case "spigot":
      return resolveSpigotVersion(input.projectId, input.name);
    case "url": {
      if (!input.url) return null;
      const filename =
        input.url.split("/").pop()?.split("?")[0] ||
        `${input.name.replace(/[^\w.-]/g, "_")}.jar`;
      return {
        versionId: "manual",
        versionName: "manual",
        filename: filename.endsWith(".jar") ? filename : `${filename}.jar`,
        downloadUrl: input.url,
        dependencies: [],
      };
    }
    default:
      return null;
  }
}

async function install(
  ctx: Awaited<ReturnType<typeof serverContext>>,
  args: {
    kind: AddonKind;
    source: string;
    projectId: string;
    name: string;
    slug?: string;
    author?: string;
    iconUrl?: string | null;
    resolved: ResolvedVersion;
    dir: string;
  },
): Promise<ServerAddon | null> {
  // Ask the node to fetch the file. Doing the download there keeps big modpacks
  // off the serverless function's memory and time budget.
  if (ctx.node) {
    await agentFetch(ctx.node, `/servers/${ctx.server.id}/addons`, {
      method: "POST",
      body: {
        dir: args.dir,
        filename: args.resolved.filename,
        url: args.resolved.downloadUrl,
      },
      timeoutMs: 120_000,
    });
  }

  const { data, error } = await ctx.supabase
    .from("server_addons")
    .upsert(
      {
        server_id: ctx.server.id,
        kind: args.kind,
        source: args.source,
        project_id: args.projectId,
        version_id: args.resolved.versionId,
        name: args.name,
        slug: args.slug ?? null,
        author: args.author ?? null,
        icon_url: args.iconUrl ?? null,
        filename: args.resolved.filename,
        download_url: args.resolved.downloadUrl,
        version_name: args.resolved.versionName,
        enabled: true,
      },
      { onConflict: "server_id,filename" },
    )
    .select()
    .single();

  if (error) throw new ApiError(error.message, 500);
  return data as ServerAddon;
}
