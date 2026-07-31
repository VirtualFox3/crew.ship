import { createHmac, timingSafeEqual } from "node:crypto";
import { optionalEnv, requireEnv } from "@/lib/env";
import { softwareInfo } from "@/lib/software";
import type { Node, Server } from "@/lib/types";

/**
 * Panel → agent transport.
 *
 * Agents are long-running daemons on real machines (see /agent). The panel runs
 * on Vercel and cannot itself hold a Minecraft process, so every stateful
 * operation is an authenticated call out to the node that owns the server.
 *
 * Requests are signed with a shared secret. Console streaming is the one thing
 * the browser does directly — it gets a short-lived, server-scoped HMAC token
 * so the WebSocket never has to traverse a serverless function.
 */

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

const agentSecret = () => requireEnv("AGENT_SHARED_SECRET");

function sign(payload: string): string {
  return createHmac("sha256", agentSecret()).update(payload).digest("base64url");
}

/**
 * Short-lived capability token scoped to one server. Handed to the browser so
 * it can open the console WebSocket straight against the node.
 */
export function issueConsoleToken(serverId: string, ttlSeconds = 900): string {
  const payload = Buffer.from(
    JSON.stringify({ sid: serverId, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyConsoleToken(token: string): { sid: string } | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      sid: string;
      exp: number;
    };
    if (data.exp * 1000 < Date.now()) return null;
    return { sid: data.sid };
  } catch {
    return null;
  }
}

interface AgentRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Agents can be slow when pulling a 2 GB modpack. */
  timeoutMs?: number;
}

export async function agentFetch<T>(
  node: Pick<Node, "agent_url">,
  path: string,
  { method = "GET", body, timeoutMs = 30_000 }: AgentRequest = {},
): Promise<T> {
  const url = `${node.agent_url.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentSecret()}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (!res.ok) {
      const message =
        (data as { error?: string } | null)?.error ?? `Node returned ${res.status}`;
      throw new AgentError(message, res.status);
    }
    return data as T;
  } catch (err) {
    if (err instanceof AgentError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new AgentError("The node did not respond in time.", 504);
    }
    throw new AgentError(
      err instanceof Error ? err.message : "Could not reach the node.",
    );
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** WebSocket URL for the live console, derived from the node's HTTP endpoint. */
export function consoleUrl(node: Pick<Node, "agent_url">, serverId: string, token: string) {
  const base = node.agent_url.replace(/^http/, "ws").replace(/\/$/, "");
  return `${base}/ws/console?server=${serverId}&token=${encodeURIComponent(token)}`;
}

/**
 * Everything the agent needs to materialise a container. Kept as a pure
 * translation of the DB row so provisioning is reproducible after a node
 * rebuild — the agent stores no configuration of its own.
 */
export function containerSpec(server: Server) {
  const info = softwareInfo(server.software);

  return {
    id: server.id,
    name: server.subdomain,
    edition: server.edition,
    type: info.agentType,
    version: server.version,
    build: server.build,
    memoryMb: server.memory_mb,
    cpuCores: server.cpu_cores,
    storageMb: server.storage_mb,
    javaPort: server.java_port,
    bedrockPort: server.bedrock_port,
    addonDir: info.addonDir,
    /** Inject Geyser + Floodgate so Bedrock clients can join a Java server. */
    crossplay: server.crossplay && info.supports.crossplay,
    autoStopMinutes: server.auto_stop_minutes,
    javaFlags: server.java_flags,
    properties: serverProperties(server),
  };
}

/** The subset of server.properties the panel owns. */
export function serverProperties(server: Server): Record<string, string> {
  return {
    "motd": server.motd,
    "max-players": String(server.max_players),
    "gamemode": server.gamemode,
    "difficulty": server.difficulty,
    "level-seed": server.seed ?? "",
    "level-type": server.level_type,
    "pvp": String(server.pvp),
    "online-mode": String(server.online_mode),
    "white-list": String(server.whitelist_on),
    "enable-command-block": String(server.command_blocks),
    "allow-flight": String(server.flight),
    "view-distance": String(server.view_distance),
    "simulation-distance": String(server.simulation_distance),
    "hardcore": String(server.hardcore),
    "spawn-protection": String(server.spawn_protection),
    "enable-rcon": "true",
  };
}

/**
 * Pick the least-loaded online node with room for the server. Returns null when
 * the fleet is full, which puts the server in the queue instead of failing.
 */
export function selectNode(nodes: Node[], memoryMb: number): Node | null {
  const candidates = nodes.filter(
    (n) =>
      n.status === "online" &&
      n.running_count < n.max_servers &&
      n.used_memory_mb + memoryMb <= n.max_memory_mb,
  );
  if (!candidates.length) return null;

  return candidates.sort((a, b) => {
    const load = (n: Node) => n.used_memory_mb / Math.max(n.max_memory_mb, 1);
    return load(a) - load(b);
  })[0];
}

/** Free port inside the node's configured range, avoiding ports already held. */
export function allocatePort(node: Node, taken: Set<number>): number | null {
  for (let port = node.port_range_start; port <= node.port_range_end; port++) {
    if (!taken.has(port)) return port;
  }
  return null;
}

/** Whether any agent is configured at all — drives the "demo mode" banner. */
export const agentConfigured = () => Boolean(optionalEnv("AGENT_SHARED_SECRET"));
