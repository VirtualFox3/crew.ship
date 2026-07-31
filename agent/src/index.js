import http from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import { WebSocketServer } from "ws";

import { config } from "./config.js";
import {
  containerLogs,
  containerStats,
  docker,
  ensureContainer,
  getContainer,
  removeServer,
  rconPassword,
  startContainer,
  stopContainer,
  stripDockerFraming,
} from "./docker.js";
import {
  activateWorld,
  createBackup,
  deleteBackup,
  listBackups,
  listWorlds,
  resetWorld,
  restoreBackup,
  writeProperties,
} from "./backups.js";
import {
  createEntry,
  deleteEntry,
  downloadInto,
  listDirectory,
  readFile,
  toggleAddon,
  writeFile,
} from "./files.js";
import { parsePlayerList, rconCommand } from "./rcon.js";
import { reportStatus, sendHeartbeat } from "./panel.js";
import { allServers, forgetServer, getServer, loadState, patchServer, upsertServer } from "./state.js";

const app = express();
app.use(express.json({ limit: "8mb" }));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function constantEquals(a, b) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

app.use((req, res, next) => {
  if (req.path === "/health") return next();

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !constantEquals(token, config.secret)) {
    return res.status(401).json({ error: "Unauthorised." });
  }
  next();
});

/** Wraps an async route so a rejection becomes a JSON error, not a hang. */
const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[agent] ${req.method} ${req.path}:`, err.message);
    res.status(err.status ?? 500).json({ error: err.message });
  });

// ---------------------------------------------------------------------------
// Health and capacity
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, node: config.nodeName, version: "1.0.0" });
});

app.get("/capacity", route(async (_req, res) => {
  const servers = allServers();
  const running = await runningIds();

  res.json({
    nodeId: config.nodeId,
    maxServers: config.maxServers,
    maxMemoryMb: config.maxMemoryMb,
    servers: servers.length,
    running: running.size,
    usedMemoryMb: servers
      .filter((s) => running.has(s.id))
      .reduce((sum, s) => sum + (s.memoryMb ?? 0), 0),
  });
}));

// ---------------------------------------------------------------------------
// Provisioning and lifecycle
// ---------------------------------------------------------------------------

/**
 * Create or reconcile a server. The panel sends the whole desired spec every
 * time, so this doubles as "apply my changes" and "rebuild after a node wipe".
 */
app.post("/servers", route(async (req, res) => {
  const spec = req.body;
  if (!spec?.id) return res.status(400).json({ error: "Missing server id." });

  if (allServers().length >= config.maxServers && !getServer(spec.id)) {
    return res.status(507).json({ error: "This node is full." });
  }

  await ensureContainer(spec);
  await upsertServer({
    id: spec.id,
    name: spec.name,
    edition: spec.edition,
    memoryMb: spec.memoryMb,
    javaPort: spec.javaPort,
    bedrockPort: spec.bedrockPort,
    addonDir: spec.addonDir,
    autoStopMinutes: spec.autoStopMinutes ?? 0,
    crossplay: Boolean(spec.crossplay),
  });

  // server.properties only exists after the first boot, so writing it here is
  // a no-op on a brand new server and an update on every subsequent call.
  await writeProperties(spec.id, spec.properties ?? {}).catch(() => {});

  // Re-fetch any add-ons the panel knows about but the volume has lost.
  for (const addon of spec.addons ?? []) {
    if (!addon.url) continue;
    await downloadInto(spec.id, spec.addonDir ?? "plugins", addon.filename, addon.url).catch(
      (err) => console.warn(`[agent] addon ${addon.filename}: ${err.message}`),
    );
  }

  res.json({ provisioned: true });
}));

app.post("/servers/:id/start", route(async (req, res) => {
  await startContainer(req.params.id);
  await patchServer(req.params.id, { lastStartedAt: new Date().toISOString(), idleSince: null });
  reportStatus(req.params.id, "starting", { detail: "Loading world" });
  res.json({ started: true });
}));

app.post("/servers/:id/stop", route(async (req, res) => {
  await stopContainer(req.params.id, { force: Boolean(req.body?.force) });
  await patchServer(req.params.id, { idleSince: null });
  reportStatus(req.params.id, "offline");
  res.json({ stopped: true });
}));

app.delete("/servers/:id", route(async (req, res) => {
  await removeServer(req.params.id);
  await forgetServer(req.params.id);
  res.json({ deleted: true });
}));

app.get("/servers/:id/stats", route(async (req, res) => {
  const found = await getContainer(req.params.id);
  if (!found?.info.State.Running) {
    return res.json({ running: false, players: 0, playerNames: [], cpu: 0, memoryMb: 0 });
  }

  const stats = await containerStats(req.params.id).catch(() => ({ cpu: 0, memoryMb: 0 }));
  const players = await queryPlayers(req.params.id).catch(() => null);

  res.json({
    running: true,
    players: players?.count ?? 0,
    playerNames: players?.names ?? [],
    ...stats,
  });
}));

app.get("/servers/:id/logs", route(async (req, res) => {
  const lines = Math.min(Math.max(Number(req.query.lines) || 200, 1), 1000);
  res.json({ lines: await containerLogs(req.params.id, lines) });
}));

app.post("/servers/:id/command", route(async (req, res) => {
  const command = String(req.body?.command ?? "").trim();
  if (!command) return res.status(400).json({ error: "Empty command." });

  const output = await runCommand(req.params.id, command);
  res.json({ output });
}));

app.patch("/servers/:id/properties", route(async (req, res) => {
  await writeProperties(req.params.id, req.body?.properties ?? {});
  res.json({ written: true });
}));

// ---------------------------------------------------------------------------
// Add-ons
// ---------------------------------------------------------------------------

app.post("/servers/:id/addons", route(async (req, res) => {
  const { dir, filename, url } = req.body ?? {};
  if (!filename || !url) return res.status(400).json({ error: "Expected { filename, url }." });

  const result = await downloadInto(req.params.id, dir || "plugins", filename, url);
  res.json(result);
}));

app.post("/servers/:id/addons/toggle", route(async (req, res) => {
  const { dir, filename, enabled } = req.body ?? {};
  await toggleAddon(req.params.id, dir || "plugins", filename, Boolean(enabled));
  res.json({ enabled: Boolean(enabled) });
}));

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

app.get("/servers/:id/files", route(async (req, res) => {
  res.json({ entries: await listDirectory(req.params.id, String(req.query.path ?? "")) });
}));

app.get("/servers/:id/files/read", route(async (req, res) => {
  res.json(await readFile(req.params.id, String(req.query.path ?? "")));
}));

app.post("/servers/:id/files/write", route(async (req, res) => {
  await writeFile(req.params.id, req.body?.path ?? "", req.body?.content ?? "");
  res.json({ saved: true });
}));

app.post("/servers/:id/files/create", route(async (req, res) => {
  await createEntry(req.params.id, req.body?.path ?? "", Boolean(req.body?.directory));
  res.json({ created: true });
}));

app.delete("/servers/:id/files", route(async (req, res) => {
  await deleteEntry(req.params.id, req.body?.path ?? "");
  res.json({ deleted: true });
}));

// ---------------------------------------------------------------------------
// Backups and worlds
// ---------------------------------------------------------------------------

app.get("/servers/:id/backups", route(async (req, res) => {
  res.json({ backups: await listBackups(req.params.id) });
}));

app.post("/servers/:id/backups", route(async (req, res) => {
  // Flush the world to disk first so the snapshot is consistent.
  await runCommand(req.params.id, "save-all flush").catch(() => {});
  res.json(await createBackup(req.params.id, req.body?.name ?? "Backup"));
}));

app.post("/servers/:id/backups/restore", route(async (req, res) => {
  await stopContainer(req.params.id);
  await restoreBackup(req.params.id, req.body?.filename ?? "");
  res.json({ restored: true });
}));

app.delete("/servers/:id/backups", route(async (req, res) => {
  await deleteBackup(req.params.id, req.body?.filename ?? "");
  res.json({ deleted: true });
}));

app.get("/servers/:id/worlds", route(async (req, res) => {
  res.json({ worlds: await listWorlds(req.params.id) });
}));

app.post("/servers/:id/worlds/reset", route(async (req, res) => {
  await stopContainer(req.params.id);
  await resetWorld(req.params.id, req.body?.seed ?? null);
  res.json({ reset: true });
}));

app.post("/servers/:id/worlds/activate", route(async (req, res) => {
  await activateWorld(req.params.id, req.body?.world ?? "");
  res.json({ activated: true });
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runCommand(id, command) {
  const server = getServer(id);
  const found = await getContainer(id);
  if (!found?.info.State.Running) {
    const error = new Error("Server is not running.");
    error.status = 409;
    throw error;
  }

  // Bedrock has no RCON; send the command on the container's stdin instead.
  if (server?.edition === "bedrock") {
    const stream = await found.container.attach({
      stream: true,
      stdin: true,
      hijack: true,
    });
    stream.write(`${command}\n`);
    stream.end();
    return "";
  }

  const password = await rconPassword(id);
  const host = found.info.NetworkSettings.IPAddress || "127.0.0.1";
  return rconCommand(host, 25575, password, command);
}

async function queryPlayers(id) {
  const server = getServer(id);
  if (server?.edition === "bedrock") return { count: 0, names: [] };
  return parsePlayerList(await runCommand(id, "list"));
}

async function runningIds() {
  const containers = await docker
    .listContainers({ filters: { label: [`host.pack.node=${config.nodeId}`] } })
    .catch(() => []);

  return new Set(
    containers.map((c) => c.Labels?.["host.pack.server"]).filter(Boolean),
  );
}

// ---------------------------------------------------------------------------
// Live console over WebSocket
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

/** Verifies the short-lived token the panel handed to the browser. */
function verifyConsoleToken(token) {
  const [payload, mac] = String(token).split(".");
  if (!payload || !mac) return null;

  const expected = createHmac("sha256", config.secret).update(payload).digest("base64url");
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.sid || data.exp * 1000 < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname !== "/ws/console") {
    socket.destroy();
    return;
  }

  const claims = verifyConsoleToken(url.searchParams.get("token") ?? "");
  const serverId = url.searchParams.get("server");

  if (!claims || claims.sid !== serverId) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, serverId);
  });
});

wss.on("connection", async (ws, _request, serverId) => {
  let logStream = null;

  try {
    const found = await getContainer(serverId);
    if (!found) {
      ws.send("[Pack.Host] This server has not been provisioned on a node yet.");
      ws.close();
      return;
    }

    logStream = await found.container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 0,
    });

    logStream.on("data", (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(stripDockerFraming(chunk));
    });
    logStream.on("error", () => ws.close());
    logStream.on("end", () => ws.close());
  } catch (err) {
    if (ws.readyState === ws.OPEN) ws.send(`[Pack.Host] ${err.message}`);
    ws.close();
  }

  // Keep intermediaries from dropping an idle socket.
  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 30_000);

  ws.on("close", () => {
    clearInterval(ping);
    logStream?.destroy?.();
  });
});

// ---------------------------------------------------------------------------
// Background loops
// ---------------------------------------------------------------------------

/**
 * Heartbeat: tells the panel what is actually running, so the dashboard is
 * accurate even if a container died on its own.
 */
async function heartbeat() {
  const running = await runningIds();
  const servers = [];
  let usedMemoryMb = 0;

  for (const record of allServers()) {
    const found = await getContainer(record.id);
    const isRunning = Boolean(found?.info.State.Running);

    let status = "offline";
    let players = 0;

    if (isRunning) {
      usedMemoryMb += record.memoryMb ?? 0;
      const list = await queryPlayers(record.id).catch(() => null);
      // RCON only answers once the world has finished loading, which is a
      // better "online" signal than the container being up.
      status = list ? "online" : "starting";
      players = list?.count ?? 0;
    } else if (found?.info.State.ExitCode) {
      status = "crashed";
    }

    servers.push({ id: record.id, status, players });
    await trackIdle(record, isRunning, players);
  }

  await sendHeartbeat({ runningCount: running.size, usedMemoryMb, servers });
}

/**
 * Idle shutdown. This is what makes free hosting affordable: a node can hold
 * far more servers than it has RAM because almost none of them are awake.
 */
async function trackIdle(record, isRunning, players) {
  const minutes = record.autoStopMinutes ?? 0;
  if (!minutes || !isRunning) {
    if (record.idleSince) await patchServer(record.id, { idleSince: null });
    return;
  }

  if (players > 0) {
    if (record.idleSince) await patchServer(record.id, { idleSince: null });
    return;
  }

  if (!record.idleSince) {
    await patchServer(record.id, { idleSince: Date.now() });
    return;
  }

  if (Date.now() - record.idleSince >= minutes * 60_000) {
    console.log(`[agent] ${record.id} idle for ${minutes}m — sleeping`);
    await stopContainer(record.id).catch(() => {});
    await patchServer(record.id, { idleSince: null });
    await reportStatus(record.id, "offline", { reason: `Slept after ${minutes} minutes idle` });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  await loadState();

  server.listen(config.port, () => {
    console.log(`[agent] ${config.nodeName} listening on :${config.port}`);
    console.log(`[agent] data dir ${config.dataDir}`);
    console.log(
      `[agent] ports ${config.portRange.start}-${config.portRange.end}, ` +
        `${config.maxServers} servers, ${config.maxMemoryMb} MB`,
    );
  });

  const tick = async () => {
    try {
      await heartbeat();
    } catch (err) {
      console.warn(`[agent] heartbeat: ${err.message}`);
    }
  };

  await tick();
  setInterval(tick, config.heartbeatMs);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[agent] ${signal} — shutting down (containers keep running)`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
