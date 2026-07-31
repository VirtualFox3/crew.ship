import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, handler, logEvent, ok, readJson } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/env";
import { promoteFromQueue } from "@/lib/provision";

export const dynamic = "force-dynamic";

function assertAgent(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(requireEnv("AGENT_SHARED_SECRET")).digest();
  if (!timingSafeEqual(a, b)) throw new ApiError("Bad agent credentials.", 401);
}

/**
 * Single-server transition pushed by the agent — used for events the heartbeat
 * would report too late, like an idle auto-stop or a crash loop.
 */
export const POST = handler(async (request: Request) => {
  assertAgent(request);

  const body = await readJson<{
    serverId: string;
    status: "online" | "starting" | "stopping" | "offline" | "crashed";
    detail?: string;
    players?: number;
    reason?: string;
  }>(request);

  if (!body.serverId || !body.status) throw new ApiError("Expected { serverId, status }.");

  const admin = createAdminClient();

  const { data: server } = await admin
    .from("servers")
    .select("*")
    .eq("id", body.serverId)
    .maybeSingle();

  if (!server) throw new ApiError("Unknown server.", 404);

  const patch: Record<string, unknown> = {
    status: body.status,
    status_detail: body.detail ?? null,
    players_online: body.players ?? (body.status === "online" ? server.players_online : 0),
  };
  if (body.status === "online") patch.last_online_at = new Date().toISOString();

  await admin.from("servers").update(patch).eq("id", body.serverId);

  if (body.status === "offline" || body.status === "crashed") {
    // Give the node's memory back before anyone else is placed on it.
    if (server.node_id) {
      const { data: node } = await admin
        .from("nodes")
        .select("running_count, used_memory_mb")
        .eq("id", server.node_id)
        .maybeSingle();

      if (node) {
        await admin
          .from("nodes")
          .update({
            running_count: Math.max(0, node.running_count - 1),
            used_memory_mb: Math.max(0, node.used_memory_mb - server.memory_mb),
          })
          .eq("id", server.node_id);
      }
    }
    await promoteFromQueue(admin);
  }

  await logEvent(admin, body.serverId, null, `agent.${body.status}`, body.reason ?? body.detail);

  return ok({ acknowledged: true });
});
