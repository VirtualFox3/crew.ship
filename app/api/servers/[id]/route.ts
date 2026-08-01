import { agentFetch } from "@/lib/agent";
import { ApiError, handler, logEvent, ok, readJson, serverContext } from "@/lib/api";
import { serverProperties } from "@/lib/agent";
import { softwareInfo } from "@/lib/software";
import { stopServer } from "@/lib/provision";
import { firstIssue, updateServerSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  // Live counters come from the node; a stale DB row would show ghost players.
  let live: { players?: number; cpu?: number; memoryMb?: number; tps?: number } = {};
  if (ctx.node && ["online", "starting"].includes(ctx.server.status)) {
    try {
      live = await agentFetch(ctx.node, `/servers/${id}/stats`, { timeoutMs: 5_000 });
    } catch {
      // Node hiccup — fall back to the last known values.
    }
  }

  return ok({
    server: ctx.server,
    node: ctx.node
      ? { id: ctx.node.id, name: ctx.node.name, region: ctx.node.region, host: ctx.node.public_host }
      : null,
    live,
  });
});

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { require: "settings" });

  const parsed = updateServerSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));
  const patch = parsed.data;

  if (patch.crossplay) {
    const info = softwareInfo((patch.software as never) ?? ctx.server.software);
    if (!info.supports.crossplay) {
      throw new ApiError(`${info.name} cannot bridge Bedrock players.`);
    }
  }

  // Swapping software or version means the jar changes: force a reinstall by
  // clearing the pinned build, and warn if it happens under a live server.
  const reinstall =
    (patch.software && patch.software !== ctx.server.software) ||
    (patch.version && patch.version !== ctx.server.version);

  const { data, error } = await ctx.supabase
    .from("servers")
    .update({
      ...patch,
      ...(reinstall ? { build: null } : {}),
      ...(patch.crossplay !== undefined
        ? { edition: patch.crossplay ? "hybrid" : ctx.server.edition === "bedrock" ? "bedrock" : "java" }
        : {}),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new ApiError(error.message, 500);

  // Push gameplay options straight through so a running server picks them up
  // on its next restart without the user editing server.properties by hand.
  if (ctx.node) {
    try {
      await agentFetch(ctx.node, `/servers/${id}/properties`, {
        method: "PATCH",
        body: { properties: serverProperties(data) },
      });
    } catch {
      // Applied on next start instead.
    }
  }

  await logEvent(ctx.admin, id, ctx.user.id, "settings.update", Object.keys(patch).join(", "));

  return ok({
    server: data,
    restartRequired: reinstall || patch.memory_mb !== undefined,
  });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  if (ctx.server.owner_id !== ctx.user.id) {
    throw new ApiError("Only the owner can delete a server.", 403);
  }

  if (ctx.server.status !== "offline") {
    await stopServer(ctx.admin, ctx.server, ctx.node, { force: true }).catch(() => {});
  }

  if (ctx.node) {
    // Purge the world and container. Best-effort: a dead node must not block
    // the user from freeing their server slot.
    await agentFetch(ctx.node, `/servers/${id}`, {
      method: "DELETE",
      timeoutMs: 60_000,
    }).catch(() => {});
  }

  const { error } = await ctx.supabase.from("servers").delete().eq("id", id);
  if (error) throw new ApiError(error.message, 500);

  return ok({ deleted: true });
});
