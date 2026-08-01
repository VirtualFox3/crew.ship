import path from "node:path";
import fs from "node:fs/promises";
import { serverDir } from "./docker.js";

/**
 * File manager, jailed to one server's directory.
 *
 * The panel validates paths too, but this is the boundary that matters: a bug
 * or a crafted request upstream must not be able to read the host filesystem.
 */

const MAX_EDIT_BYTES = 2 * 1024 * 1024;

export function resolveInside(serverId, relative = "") {
  const root = path.resolve(serverDir(serverId));
  const target = path.resolve(root, relative.replace(/^[/\\]+/, ""));

  if (target !== root && !target.startsWith(root + path.sep)) {
    const error = new Error("Path escapes the server directory.");
    error.status = 400;
    throw error;
  }
  return { root, target };
}

export async function listDirectory(serverId, relative = "") {
  const { root, target } = resolveInside(serverId, relative);

  let dirents;
  try {
    dirents = await fs.readdir(target, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const entries = await Promise.all(
    dirents
      // Internal bookkeeping; not the user's business.
      .filter((d) => d.name !== ".packhost-rcon")
      .map(async (dirent) => {
        const full = path.join(target, dirent.name);
        let stat;
        try {
          stat = await fs.stat(full);
        } catch {
          return null;
        }
        return {
          name: dirent.name,
          path: path.relative(root, full).split(path.sep).join("/"),
          directory: dirent.isDirectory(),
          size: stat.size,
          modified: stat.mtime.toISOString(),
          mode: (stat.mode & 0o777).toString(8),
        };
      }),
  );

  return entries.filter(Boolean);
}

export async function readFile(serverId, relative) {
  const { target } = resolveInside(serverId, relative);
  const stat = await fs.stat(target);

  if (stat.isDirectory()) {
    const error = new Error("That is a directory.");
    error.status = 400;
    throw error;
  }

  const truncated = stat.size > MAX_EDIT_BYTES;
  const handle = await fs.open(target, "r");
  try {
    const length = truncated ? MAX_EDIT_BYTES : stat.size;
    const buffer = Buffer.alloc(length);
    // Tail the file when truncating: the end of a log is the useful part.
    await handle.read(buffer, 0, length, truncated ? stat.size - length : 0);
    return { content: buffer.toString("utf8"), truncated };
  } finally {
    await handle.close();
  }
}

export async function writeFile(serverId, relative, content) {
  const { target } = resolveInside(serverId, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

export async function createEntry(serverId, relative, directory) {
  const { target } = resolveInside(serverId, relative);
  if (directory) {
    await fs.mkdir(target, { recursive: true });
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "", { flag: "wx" });
  }
}

export async function deleteEntry(serverId, relative) {
  const { root, target } = resolveInside(serverId, relative);
  if (target === root) {
    const error = new Error("Refusing to delete the server root.");
    error.status = 400;
    throw error;
  }
  await fs.rm(target, { recursive: true, force: true });
}

/** Recursive size, used for the world list. */
export async function directorySize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(full);
    } else {
      try {
        total += (await fs.stat(full)).size;
      } catch {
        // Raced with the server deleting a chunk file; skip it.
      }
    }
  }
  return total;
}

/** Downloads an add-on jar straight onto the node. */
export async function downloadInto(serverId, dir, filename, url) {
  const safeName = path.basename(filename).replace(/[^\w.\-+]/g, "_");
  const { target } = resolveInside(serverId, path.posix.join(dir, safeName));

  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Pack.Host-Agent/1.0" },
  });

  if (!response.ok) {
    const error = new Error(`Download failed (${response.status}).`);
    error.status = 502;
    throw error;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));

  return { filename: safeName, path: path.posix.join(dir, safeName) };
}

/** Enable/disable an add-on by renaming it, the convention every loader honours. */
export async function toggleAddon(serverId, dir, filename, enabled) {
  const base = filename.replace(/\.disabled$/, "");
  const from = enabled ? `${base}.disabled` : base;
  const to = enabled ? base : `${base}.disabled`;

  const { target: source } = resolveInside(serverId, path.posix.join(dir, from));
  const { target: destination } = resolveInside(serverId, path.posix.join(dir, to));

  await fs.rename(source, destination).catch((err) => {
    if (err.code !== "ENOENT") throw err;
    // Already in the requested state.
  });
}
