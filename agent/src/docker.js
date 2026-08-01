import path from "node:path";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import Docker from "dockerode";
import { config } from "./config.js";

/**
 * Container lifecycle.
 *
 * Every Minecraft server is one container built from the itzg images, which
 * already know how to fetch a jar for any type/version combination. The agent's
 * job is to translate the panel's spec into environment variables, own the
 * volume, and keep the two in sync.
 */

export const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export const containerName = (id) => `packhost-${id}`;
export const serverDir = (id) => path.join(config.dataDir, "servers", id);
export const backupDir = (id) => path.join(config.dataDir, "backups", id);

/** Per-server RCON password, generated once and kept on disk with the world. */
async function rconPassword(id) {
  const file = path.join(serverDir(id), ".packhost-rcon");
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    const password = randomBytes(24).toString("base64url");
    await fs.mkdir(serverDir(id), { recursive: true });
    await fs.writeFile(file, password, { mode: 0o600 });
    return password;
  }
}

export async function getContainer(id) {
  try {
    const container = docker.getContainer(containerName(id));
    const info = await container.inspect();
    return { container, info };
  } catch {
    return null;
  }
}

async function pullImage(image) {
  const [existing] = await docker.listImages({ filters: { reference: [image] } });
  if (existing) return;

  await new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (doneErr) => (doneErr ? reject(doneErr) : resolve()));
    });
  });
}

/**
 * Environment for itzg/minecraft-server. The image resolves the download URL
 * for every TYPE/VERSION pair itself, which is what makes "any version, any
 * software" a one-line change here rather than a download matrix.
 */
export function javaEnv(spec, password) {
  const env = {
    EULA: "TRUE",
    TYPE: spec.type,
    VERSION: spec.version,
    MEMORY: "",                      // superseded by explicit Xms/Xmx below
    INIT_MEMORY: `${spec.memoryMb}M`,
    MAX_MEMORY: `${spec.memoryMb}M`,
    ENABLE_RCON: "true",
    RCON_PASSWORD: password,
    RCON_PORT: "25575",
    // Aikar's flags are the community default for GC pauses under load.
    USE_AIKAR_FLAGS: spec.javaFlags ? "false" : "true",
    OVERRIDE_SERVER_PROPERTIES: "true",
    SKIP_SUDO: "true",
    // The panel owns these; the image writes them into server.properties.
    MAX_PLAYERS: String(spec.properties["max-players"] ?? 20),
    MOTD: spec.properties.motd ?? "",
    DIFFICULTY: spec.properties.difficulty ?? "normal",
    MODE: spec.properties.gamemode ?? "survival",
    PVP: spec.properties.pvp ?? "true",
    ONLINE_MODE: spec.properties["online-mode"] ?? "true",
    ENABLE_WHITELIST: spec.properties["white-list"] ?? "false",
    ENABLE_COMMAND_BLOCK: spec.properties["enable-command-block"] ?? "true",
    ALLOW_FLIGHT: spec.properties["allow-flight"] ?? "false",
    VIEW_DISTANCE: spec.properties["view-distance"] ?? "10",
    SIMULATION_DISTANCE: spec.properties["simulation-distance"] ?? "10",
    HARDCORE: spec.properties.hardcore ?? "false",
    SPAWN_PROTECTION: spec.properties["spawn-protection"] ?? "0",
    LEVEL_TYPE: spec.properties["level-type"] ?? "minecraft:normal",
  };

  if (spec.build) env.BUILD_ID = String(spec.build);
  if (spec.properties["level-seed"]) env.SEED = spec.properties["level-seed"];
  if (spec.javaFlags) env.JVM_XX_OPTS = spec.javaFlags;

  // Geyser + Floodgate let Bedrock clients join a Java server. The image can
  // fetch both from Modrinth, so crossplay is a config flip, not a build step.
  if (spec.crossplay) {
    env.MODRINTH_PROJECTS = "geyser,floodgate";
    env.MODRINTH_DOWNLOAD_DEPENDENCIES = "required";
  }

  return env;
}

export function bedrockEnv(spec) {
  return {
    EULA: "TRUE",
    VERSION: spec.version,
    SERVER_NAME: spec.properties.motd ?? "Pack.Host",
    GAMEMODE: spec.properties.gamemode ?? "survival",
    DIFFICULTY: spec.properties.difficulty ?? "normal",
    MAX_PLAYERS: String(spec.properties["max-players"] ?? 20),
    ALLOW_CHEATS: spec.properties["enable-command-block"] ?? "true",
    ONLINE_MODE: spec.properties["online-mode"] ?? "true",
    VIEW_DISTANCE: spec.properties["view-distance"] ?? "10",
    LEVEL_SEED: spec.properties["level-seed"] ?? "",
  };
}

/**
 * Container-internal ports and their host bindings.
 *
 * Java always listens on 25565/tcp. Geyser (crossplay) and native Bedrock both
 * listen on 19132/udp — the difference is only which image is running, so both
 * map that same container port out to the server's allocated bedrock port.
 */
export function portConfig(spec) {
  const exposed = {};
  const bindings = {};

  if (spec.edition === "bedrock") {
    exposed["19132/udp"] = {};
    bindings["19132/udp"] = [{ HostPort: String(spec.bedrockPort ?? spec.javaPort) }];
    return { exposed, bindings };
  }

  exposed["25565/tcp"] = {};
  bindings["25565/tcp"] = [{ HostPort: String(spec.javaPort) }];

  if (spec.crossplay && spec.bedrockPort) {
    exposed["19132/udp"] = {};
    bindings["19132/udp"] = [{ HostPort: String(spec.bedrockPort) }];
  }
  return { exposed, bindings };
}

const toEnvArray = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`);

/**
 * Creates (or recreates) the container for a server. Idempotent: calling it
 * again after a config change replaces the container but keeps the volume, so
 * "apply my new settings" and "repair my server" are the same operation.
 */
export async function ensureContainer(spec) {
  const dir = serverDir(spec.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(backupDir(spec.id), { recursive: true });

  const password = await rconPassword(spec.id);
  const bedrock = spec.edition === "bedrock";
  const image = bedrock ? config.images.bedrock : config.images.java;

  await pullImage(image);

  const env = bedrock ? bedrockEnv(spec) : javaEnv(spec, password);

  const { exposed, bindings } = portConfig(spec);

  const existing = await getContainer(spec.id);
  if (existing) {
    if (existing.info.State.Running) {
      await existing.container.stop({ t: 30 }).catch(() => {});
    }
    await existing.container.remove({ force: true }).catch(() => {});
  }

  const container = await docker.createContainer({
    name: containerName(spec.id),
    Image: image,
    Env: toEnvArray(env),
    ExposedPorts: exposed,
    Tty: true,
    OpenStdin: true,
    Labels: {
      "host.pack.server": spec.id,
      "host.pack.node": config.nodeId,
    },
    HostConfig: {
      Binds: [`${dir}:${bedrock ? "/data" : "/data"}`],
      PortBindings: bindings,
      // Hard caps so one server cannot starve its neighbours on a shared node.
      Memory: (spec.memoryMb + 512) * 1024 * 1024,
      MemorySwap: (spec.memoryMb + 512) * 1024 * 1024,
      NanoCpus: Math.round((spec.cpuCores ?? 2) * 1e9),
      RestartPolicy: { Name: "no" },
      LogConfig: {
        Type: "json-file",
        Config: { "max-size": "20m", "max-file": "3" },
      },
    },
  });

  return { container, rconPassword: password };
}

export async function startContainer(id) {
  const found = await getContainer(id);
  if (!found) throw new Error("Container does not exist. Provision it first.");
  if (found.info.State.Running) return;
  await found.container.start();
}

export async function stopContainer(id, { force = false } = {}) {
  const found = await getContainer(id);
  if (!found) return;
  if (!found.info.State.Running) return;

  if (force) {
    await found.container.kill().catch(() => {});
    return;
  }
  // Generous timeout: a large world can take a while to save.
  await found.container.stop({ t: 60 }).catch(() => {});
}

export async function removeServer(id) {
  const found = await getContainer(id);
  if (found) {
    await found.container.remove({ force: true }).catch(() => {});
  }
  await fs.rm(serverDir(id), { recursive: true, force: true });
  await fs.rm(backupDir(id), { recursive: true, force: true });
}

export async function containerLogs(id, lines = 200) {
  const found = await getContainer(id);
  if (!found) return [];

  const buffer = await found.container.logs({
    stdout: true,
    stderr: true,
    tail: lines,
  });

  return stripDockerFraming(buffer)
    .split(/\r?\n/)
    .filter(Boolean);
}

/**
 * Docker multiplexes stdout/stderr with an 8-byte header per frame when the
 * container has no TTY. Ours use a TTY, but logs from an older container may
 * not, so strip defensively.
 */
export function stripDockerFraming(buffer) {
  if (!Buffer.isBuffer(buffer)) return String(buffer);

  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    const type = buffer[offset];
    // A real frame header starts with stream type 0-2 and three zero bytes.
    if (
      (type === 0 || type === 1 || type === 2) &&
      buffer[offset + 1] === 0 &&
      buffer[offset + 2] === 0 &&
      buffer[offset + 3] === 0 &&
      offset + 8 <= buffer.length
    ) {
      const size = buffer.readUInt32BE(offset + 4);
      chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
      offset += 8 + size;
    } else {
      chunks.push(buffer.subarray(offset));
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function containerStats(id) {
  const found = await getContainer(id);
  if (!found?.info.State.Running) return { cpu: 0, memoryMb: 0 };

  const stats = await found.container.stats({ stream: false });

  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage ?? 0);
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage ?? 0);
  const cores = stats.cpu_stats.online_cpus || 1;

  return {
    cpu: systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * cores * 100) : 0,
    memoryMb: Math.round((stats.memory_stats.usage ?? 0) / 1024 / 1024),
  };
}

export { rconPassword };
