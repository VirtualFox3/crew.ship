import path from "node:path";
import fs from "node:fs/promises";
import { config } from "./config.js";

/**
 * The agent's own record of the servers it hosts.
 *
 * The panel's database is authoritative, but the agent needs enough locally to
 * survive a restart without the panel: which containers it owns, their ports,
 * their memory, and their idle-stop policy. Kept as one small JSON file that is
 * rewritten atomically.
 */

const file = () => path.join(config.dataDir, "state.json");

let state = { servers: {} };
let writing = null;

export async function loadState() {
  try {
    state = JSON.parse(await fs.readFile(file(), "utf8"));
    if (!state.servers) state.servers = {};
  } catch {
    state = { servers: {} };
  }
  return state;
}

async function persist() {
  // Serialise writes: several routes can mutate state in the same tick.
  writing = (writing ?? Promise.resolve()).then(async () => {
    await fs.mkdir(config.dataDir, { recursive: true });
    const temp = `${file()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(state, null, 2));
    await fs.rename(temp, file());
  });
  return writing;
}

export function getServer(id) {
  return state.servers[id] ?? null;
}

export function allServers() {
  return Object.values(state.servers);
}

export async function upsertServer(spec) {
  state.servers[spec.id] = {
    ...(state.servers[spec.id] ?? {}),
    ...spec,
    updatedAt: new Date().toISOString(),
  };
  await persist();
  return state.servers[spec.id];
}

export async function patchServer(id, patch) {
  if (!state.servers[id]) return null;
  Object.assign(state.servers[id], patch);
  await persist();
  return state.servers[id];
}

export async function forgetServer(id) {
  delete state.servers[id];
  await persist();
}
