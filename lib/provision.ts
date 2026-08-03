import type { SupabaseClient } from "@supabase/supabase-js";
import { agentFetch, allocatePort, containerSpec, selectNode } from "@/lib/agent";
import { ApiError } from "@/lib/api";
import type { Node, Server, ServerAddon } from "@/lib/types";

/**
 * Placement and lifecycle.
 *
 * A server is sticky to a node once placed — its world lives on that node's
 * disk. Placement is deferred until the first start so an idle account costs
 * the fleet nothing, which is what makes "free" affordable.
 */

export async function onlineNodes(admin: SupabaseClient, ownerId: string): Promise<Node[]> {
  const { data } = await admin
    .from("nodes")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("status", "online");
  return (data as Node[] | null) ?? [];
}

/** Ports already claimed on a node, across both editions. */
async function takenPorts(admin: SupabaseClient, nodeId: string): Promise<Set<number>> {
  const { data } = await admin
    .from("servers")
    .select("java_port, bedrock_port")
    .eq("node_id", nodeId);

  const taken = new Set<number>();
  for (const row of data ?? []) {
    if (row.java_port) taken.add(row.java_port);
    if (row.bedrock_port) taken.add(row.bedrock_port);
  }
  return taken;
}

export interface Placement {
  node: Node;
  javaPort: number | null;
  bedrockPort: number | null;
}

/**
 * Finds room for a server. Returns null when the fleet is full — the caller
 * queues rather than erroring, so a busy evening never loses a server.
 */
export async function place(
  admin: SupabaseClient,
  server: Server,
): Promise<Placement | null> {
  const node =
    (server.node_id
      ? ((await admin.from("nodes").select("*").eq("id", server.node_id).maybeSingle())
          .data as Node | null)
      : null) ?? selectNode(await onlineNodes(admin, server.owner_id), server.memory_mb);

  if (!node || node.status !== "online") return null;

  const taken = await takenPorts(admin, node.id);
  // Keep already-assigned ports so a restart does not move the address.
  const wantsJava = server.edition !== "bedrock";
  const wantsBedrock = server.edition !== "java" || server.crossplay;

  let javaPort = server.java_port;
  if (wantsJava && !javaPort) {
    javaPort = allocatePort(node, taken);
    if (!javaPort) return null;
    taken.add(javaPort);
  }

  let bedrockPort = server.bedrock_port;
  if (wantsBedrock && !bedrockPort) {
    bedrockPort = allocatePort(node, taken);
    if (!bedrockPort) return null;
    taken.add(bedrockPort);
  }

  return {
    node,
    javaPort: wantsJava ? javaPort : null,
    bedrockPort: wantsBedrock ? bedrockPort : null,
  };
}

/** How many servers are ahead of this one in the global waiting line. */
export async function queuePosition(
  admin: SupabaseClient,
  server: Server,
): Promise<number> {
  const { count } = await admin
    .from("servers")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .lt("updated_at", server.updated_at);

  return (count ?? 0) + 1;
}

export interface StartResult {
  status: Server["status"];
  queuePosition?: number;
  node?: Node;
}

/**
 * Boots a server: place it, hand the agent the full spec plus every installed
 * add-on, and let the agent reconcile. The agent's create call is idempotent,
 * so this doubles as "repair my server" after a node rebuild.
 */
export async function startServer(
  admin: SupabaseClient,
  server: Server,
): Promise<StartResult> {
  const placement = await place(admin, server);

  if (!placement) {
    await admin
      .from("servers")
      .update({
        status: "queued",
        status_detail: "Waiting for a free slot",
        updated_at: new Date().toISOString(),
      })
      .eq("id", server.id);

    const position = await queuePosition(admin, { ...server, status: "queued" });
    await admin.from("servers").update({ queue_position: position }).eq("id", server.id);
    return { status: "queued", queuePosition: position };
  }

  const { node, javaPort, bedrockPort } = placement;
  const placed: Server = {
    ...server,
    node_id: node.id,
    java_port: javaPort,
    bedrock_port: bedrockPort,
  };

  const { data: addons } = await admin
    .from("server_addons")
    .select("*")
    .eq("server_id", server.id)
    .eq("enabled", true);

  await admin
    .from("servers")
    .update({
      node_id: node.id,
      java_port: javaPort,
      bedrock_port: bedrockPort,
      status: "preparing",
      status_detail: "Preparing files",
      queue_position: null,
    })
    .eq("id", server.id);

  try {
    await agentFetch(node, "/servers", {
      method: "POST",
      body: {
        ...containerSpec(placed),
        addons: ((addons as ServerAddon[] | null) ?? []).map((a) => ({
          kind: a.kind,
          filename: a.filename,
          url: a.download_url,
        })),
      },
      // Cold-starting a big modpack means downloading a jar and a mod list.
      timeoutMs: 120_000,
    });

    await agentFetch(node, `/servers/${server.id}/start`, { method: "POST" });

    await admin
      .from("servers")
      .update({ status: "starting", status_detail: "Loading world" })
      .eq("id", server.id);

    await admin
      .from("nodes")
      .update({
        running_count: node.running_count + 1,
        used_memory_mb: node.used_memory_mb + server.memory_mb,
      })
      .eq("id", node.id);

    return { status: "starting", node };
  } catch (err) {
    await admin
      .from("servers")
      .update({
        status: "crashed",
        status_detail: err instanceof Error ? err.message.slice(0, 180) : "Start failed",
      })
      .eq("id", server.id);
    throw err;
  }
}

export async function stopServer(
  admin: SupabaseClient,
  server: Server,
  node: Node | null,
  { force = false } = {},
): Promise<void> {
  if (!node) {
    await admin
      .from("servers")
      .update({ status: "offline", status_detail: null, players_online: 0 })
      .eq("id", server.id);
    return;
  }

  await admin
    .from("servers")
    .update({ status: "stopping", status_detail: force ? "Killing" : "Saving world" })
    .eq("id", server.id);

  await agentFetch(node, `/servers/${server.id}/stop`, {
    method: "POST",
    body: { force },
    timeoutMs: 60_000,
  });

  await admin
    .from("servers")
    .update({
      status: "offline",
      status_detail: null,
      players_online: 0,
      last_online_at: new Date().toISOString(),
    })
    .eq("id", server.id);

  await admin
    .from("nodes")
    .update({
      running_count: Math.max(0, node.running_count - 1),
      used_memory_mb: Math.max(0, node.used_memory_mb - server.memory_mb),
    })
    .eq("id", node.id);

  // A slot just opened; hand it to whoever has waited longest.
  await promoteFromQueue(admin);
}

/** Starts the oldest queued server if the fleet now has room for it. */
export async function promoteFromQueue(admin: SupabaseClient): Promise<void> {
  const { data } = await admin
    .from("servers")
    .select("*")
    .eq("status", "queued")
    .order("updated_at", { ascending: true })
    .limit(50);

  // Queues are per owner: an offline home computer must not block another
  // owner's online computer from accepting its next server.
  for (const next of (data as Server[] | null) ?? []) {
    if (!(await place(admin, next))) continue;
    try {
      await startServer(admin, next);
    } catch {
      // The next stop/heartbeat will retry; never fail the caller's request.
    }
    return;
  }
}

export function assertNodeCapacity(node: Node | null) {
  if (!node) {
    throw new ApiError("No node is available right now. Try again shortly.", 503);
  }
}
