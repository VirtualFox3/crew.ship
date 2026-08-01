import { config } from "./config.js";

/**
 * Agent → panel reporting.
 *
 * The panel is the source of truth for what *should* be running; the agent is
 * the source of truth for what *is*. These calls reconcile the two, and every
 * one of them is best-effort: a panel outage must never stop a Minecraft
 * server that is happily serving players.
 */

async function post(path, body) {
  if (!config.panelUrl) return null;

  try {
    const res = await fetch(`${config.panelUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[panel] ${path} → ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[panel] ${path} failed: ${err.message}`);
    return null;
  }
}

export function sendHeartbeat({ runningCount, usedMemoryMb, servers }) {
  return post("/api/internal/nodes", {
    nodeId: config.nodeId,
    status: "online",
    runningCount,
    usedMemoryMb,
    servers,
  });
}

export function reportStatus(serverId, status, extra = {}) {
  return post("/api/internal/status", { serverId, status, ...extra });
}
