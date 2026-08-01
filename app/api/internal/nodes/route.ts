import { createHash, timingSafeEqual } from "node:crypto";
import { handler, ApiError, ok, readJson } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/env";
import { promoteFromQueue } from "@/lib/provision";

export const dynamic = "force-dynamic";

/**
 * Agent → panel callback surface.
 *
 * Nodes are trusted infrastructure, so this endpoint is authenticated with the
 * shared secret rather than a user session. It is excluded from the auth
 * middleware (see middleware.ts matcher).
 */
function assertAgent(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  const expected = requireEnv("AGENT_SHARED_SECRET");
  // Hash both sides so the comparison is constant-length as well as constant-time.
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) throw new ApiError("Bad agent credentials.", 401);
}

interface Heartbeat {
  nodeId: string;
  status?: "online" | "draining" | "offline";
  arch?: "x64" | "arm64";
  runningCount?: number;
  usedMemoryMb?: number;
  servers?: {
    id: string;
    status: "online" | "starting" | "stopping" | "offline" | "crashed";
    detail?: string | null;
    players?: number;
  }[];
}

export const POST = handler(async (request: Request) => {
  assertAgent(request);

  const body = await readJson<Heartbeat>(request);
  if (!body.nodeId) throw new ApiError("Missing nodeId.");

  const admin = createAdminClient();

  const { data: node, error } = await admin
    .from("nodes")
    .update({
      status: body.status ?? "online",
      ...(body.arch ? { arch: body.arch } : {}),
      running_count: body.runningCount ?? 0,
      used_memory_mb: body.usedMemoryMb ?? 0,
      last_heartbeat: new Date().toISOString(),
    })
    .eq("id", body.nodeId)
    .select()
    .maybeSingle();

  if (error) throw new ApiError(error.message, 500);
  if (!node) throw new ApiError("Unknown node.", 404);

  // Reconcile server rows with what the node actually has running. The node is
  // the source of truth here — a container that died takes the row with it.
  let freed = false;
  for (const s of body.servers ?? []) {
    const patch: Record<string, unknown> = {
      status: s.status,
      status_detail: s.detail ?? null,
      players_online: s.players ?? 0,
    };
    if (s.status === "online") patch.last_online_at = new Date().toISOString();
    if (s.status === "offline" || s.status === "crashed") {
      patch.players_online = 0;
      freed = true;
    }
    await admin.from("servers").update(patch).eq("id", s.id).eq("node_id", body.nodeId);
  }

  if (freed) await promoteFromQueue(admin);

  return ok({ acknowledged: true, serverCount: body.servers?.length ?? 0 });
});
