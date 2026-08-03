import { NextResponse } from "next/server";
import { ApiError, handler, ok, readJson, requireUser } from "@/lib/api";
import { createServerSchema, firstIssue } from "@/lib/validation";
import { runsOn, softwareInfo } from "@/lib/software";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NodeArch, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Every server the caller owns or has been given access to. */
export const GET = handler(async () => {
  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from("servers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new ApiError(error.message, 500);
  return ok({ servers: data ?? [] });
});

export const POST = handler(async (request: Request) => {
  const { user, supabase } = await requireUser();
  const body = await readJson<unknown>(request);

  const parsed = createServerSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));
  const input = parsed.data;

  const info = softwareInfo(input.software as never);

  // Bedrock software cannot run a Java edition server, and vice versa.
  if (info.edition === "bedrock" && input.edition === "java") {
    throw new ApiError(`${info.name} is a Bedrock server — pick the Bedrock edition.`);
  }
  if (info.edition === "java" && input.edition === "bedrock") {
    throw new ApiError(`${info.name} is a Java server — pick the Java edition.`);
  }
  const crossplay = input.crossplay && info.supports.crossplay;
  if (input.crossplay && !info.supports.crossplay) {
    throw new ApiError(`${info.name} cannot bridge Bedrock players. Try Paper or Fabric.`);
  }

  // Refuse hardware the fleet cannot run before taking the user's settings.
  // The wizard greys these out, but a direct API call must not slip past.
  try {
    const admin = createAdminClient();
    const { data: nodes } = await admin
      .from("nodes")
      .select("arch")
      .eq("owner_id", user.id)
      .eq("status", "online");
    const arches = [...new Set((nodes ?? []).map((n) => n.arch as NodeArch))];
    if (arches.length && !arches.some((a) => runsOn(info, a))) {
      throw new ApiError(
        `${info.name} needs an ${info.arch?.join(" or ")} node, and none is online. ` +
          `Try Paper or Fabric with crossplay to reach Bedrock players.`,
        409,
      );
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // No service-role key yet; placement will surface the problem instead.
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("server_limit")
    .eq("id", user.id)
    .maybeSingle();

  const limit = (profile as Pick<Profile, "server_limit"> | null)?.server_limit ?? 4;

  const { count } = await supabase
    .from("servers")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);

  if ((count ?? 0) >= limit) {
    throw new ApiError(
      `You already have ${limit} servers. Delete one to make room.`,
      409,
    );
  }

  const { data: existing } = await supabase
    .from("servers")
    .select("id")
    .eq("subdomain", input.subdomain)
    .maybeSingle();

  if (existing) throw new ApiError("That address is already taken.", 409);

  const { data, error } = await supabase
    .from("servers")
    .insert({
      owner_id: user.id,
      name: input.name,
      subdomain: input.subdomain,
      edition: crossplay ? "hybrid" : input.edition,
      software: input.software,
      version: input.version,
      memory_mb: input.memory_mb,
      max_players: input.max_players,
      crossplay,
      motd: input.motd,
      gamemode: input.gamemode,
      difficulty: input.difficulty,
      seed: input.seed || null,
      hardcore: input.hardcore,
      status: "offline",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") throw new ApiError("That address is already taken.", 409);
    throw new ApiError(error.message, 500);
  }

  return NextResponse.json({ server: data }, { status: 201 });
});
