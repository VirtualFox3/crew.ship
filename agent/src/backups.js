import path from "node:path";
import fs from "node:fs/promises";
import * as tar from "tar";
import { backupDir, serverDir } from "./docker.js";
import { directorySize } from "./files.js";

/**
 * Backups are plain gzipped tars of the server directory. Boring on purpose:
 * a user can download one and open it anywhere, which is the point of not
 * locking anybody in.
 */

// Regenerated on start, or huge and not worth capturing.
const EXCLUDED = new Set(["cache", "libraries", "versions", "logs", ".howlhost-rcon"]);

export async function createBackup(serverId, name) {
  const source = serverDir(serverId);
  const destination = backupDir(serverId);
  await fs.mkdir(destination, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${stamp}.tar.gz`;
  const filePath = path.join(destination, filename);

  const entries = (await fs.readdir(source)).filter((entry) => !EXCLUDED.has(entry));

  await tar.create({ gzip: true, file: filePath, cwd: source }, entries);

  const { size } = await fs.stat(filePath);
  return { filename, sizeBytes: size, name };
}

export async function restoreBackup(serverId, filename) {
  const archive = path.join(backupDir(serverId), path.basename(filename));
  await fs.access(archive);

  const target = serverDir(serverId);

  // Clear what the archive is about to replace, leaving caches and the RCON
  // secret in place so the server can still start afterwards.
  for (const entry of await fs.readdir(target)) {
    if (EXCLUDED.has(entry)) continue;
    await fs.rm(path.join(target, entry), { recursive: true, force: true });
  }

  await tar.extract({ file: archive, cwd: target });
}

export async function deleteBackup(serverId, filename) {
  await fs.rm(path.join(backupDir(serverId), path.basename(filename)), { force: true });
}

export async function listBackups(serverId) {
  const dir = backupDir(serverId);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const backups = await Promise.all(
    files
      .filter((f) => f.endsWith(".tar.gz"))
      .map(async (filename) => {
        const stat = await fs.stat(path.join(dir, filename));
        return {
          filename,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      }),
  );

  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

/** A directory counts as a world when it holds a level.dat. */
async function isWorld(dir) {
  try {
    await fs.access(path.join(dir, "level.dat"));
    return true;
  } catch {
    return false;
  }
}

export async function listWorlds(serverId) {
  const root = serverDir(serverId);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const active = await activeWorldName(serverId);
  const worlds = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (!(await isWorld(full))) continue;

    worlds.push({
      name: entry.name,
      sizeBytes: await directorySize(full),
      active: entry.name === active,
    });
  }

  return worlds;
}

async function readProperties(serverId) {
  try {
    const text = await fs.readFile(path.join(serverDir(serverId), "server.properties"), "utf8");
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      map.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
    }
    return map;
  } catch {
    return new Map();
  }
}

async function activeWorldName(serverId) {
  const properties = await readProperties(serverId);
  return properties.get("level-name") || "world";
}

export async function writeProperties(serverId, patch) {
  const file = path.join(serverDir(serverId), "server.properties");
  const existing = await readProperties(serverId);

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null) existing.set(key, String(value));
  }

  const body = [...existing.entries()].map(([k, v]) => `${k}=${v}`).join("\n");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `# Managed by Howl.Host\n${body}\n`);
}

/** Deletes the active world so the server regenerates it on next start. */
export async function resetWorld(serverId, seed) {
  const name = await activeWorldName(serverId);
  const root = serverDir(serverId);

  // Paper and friends split dimensions into sibling folders.
  for (const suffix of ["", "_nether", "_the_end"]) {
    await fs.rm(path.join(root, `${name}${suffix}`), { recursive: true, force: true });
  }

  await writeProperties(serverId, { "level-seed": seed ?? "" });
}

export async function activateWorld(serverId, world) {
  const { target } = { target: path.join(serverDir(serverId), path.basename(world)) };
  await fs.access(path.join(target, "level.dat"));
  await writeProperties(serverId, { "level-name": path.basename(world) });
}
