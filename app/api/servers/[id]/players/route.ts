import { agentFetch } from "@/lib/agent";
import { ApiError, handler, logEvent, ok, readJson, serverContext } from "@/lib/api";
import { firstIssue, playerSchema } from "@/lib/validation";
import type { ServerPlayer } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Console command that applies a list change to a live server. */
function commandFor(
  action: "add" | "remove",
  list: ServerPlayer["list"],
  username: string,
  level?: number | null,
  reason?: string | null,
): string {
  if (list === "whitelist") return `whitelist ${action === "add" ? "add" : "remove"} ${username}`;
  if (list === "op") {
    return action === "add"
      ? `op ${username}${level && level !== 4 ? ` ${level}` : ""}`
      : `deop ${username}`;
  }
  return action === "add"
    ? `ban ${username}${reason ? ` ${reason}` : ""}`
    : `pardon ${username}`;
}

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  const { data, error } = await ctx.supabase
    .from("server_players")
    .select("*")
    .eq("server_id", id)
    .order("created_at", { ascending: false });

  if (error) throw new ApiError(error.message, 500);

  // Who is actually connected right now, straight from the node.
  let online: string[] = [];
  if (ctx.node && ctx.server.status === "online") {
    try {
      const stats = await agentFetch<{ playerNames?: string[] }>(
        ctx.node,
        `/servers/${id}/stats`,
        { timeoutMs: 5_000 },
      );
      online = stats.playerNames ?? [];
    } catch {
      // Non-fatal: the lists below are still correct.
    }
  }

  return ok({ players: (data as ServerPlayer[]) ?? [], online });
});

export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { require: "players" });

  const parsed = playerSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));
  const { list, username, level, reason } = parsed.data;

  const { data, error } = await ctx.supabase
    .from("server_players")
    .upsert(
      {
        server_id: id,
        list,
        username,
        level: list === "op" ? (level ?? 4) : null,
        reason: list === "ban" ? (reason ?? null) : null,
      },
      { onConflict: "server_id,list,username" },
    )
    .select()
    .single();

  if (error) throw new ApiError(error.message, 500);

  // Apply immediately when the server is up; otherwise it lands on next start.
  if (ctx.node && ctx.server.status === "online") {
    await agentFetch(ctx.node, `/servers/${id}/command`, {
      method: "POST",
      body: { command: commandFor("add", list, username, level, reason) },
    }).catch(() => {});
  }

  await logEvent(ctx.admin, id, ctx.user.id, `player.${list}.add`, username);
  return ok({ player: data }, 201);
});

export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { require: "players" });

  const playerId = new URL(request.url).searchParams.get("player");
  if (!playerId) throw new ApiError("Missing player id.");

  const { data: player } = await ctx.supabase
    .from("server_players")
    .select("*")
    .eq("id", playerId)
    .eq("server_id", id)
    .maybeSingle();

  if (!player) throw new ApiError("Not on that list.", 404);

  await ctx.supabase.from("server_players").delete().eq("id", playerId);

  if (ctx.node && ctx.server.status === "online") {
    await agentFetch(ctx.node, `/servers/${id}/command`, {
      method: "POST",
      body: { command: commandFor("remove", player.list, player.username) },
    }).catch(() => {});
  }

  await logEvent(ctx.admin, id, ctx.user.id, `player.${player.list}.remove`, player.username);
  return ok({ removed: true });
});
