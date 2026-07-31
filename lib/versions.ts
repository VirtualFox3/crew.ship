import type { ServerSoftware } from "./types";

/**
 * Version catalogue.
 *
 * Every list is pulled live from the upstream project so a Minecraft release is
 * selectable the day it ships — nothing here is a hand-maintained allowlist.
 * Responses are cached for an hour; if an upstream is down we degrade to a
 * static fallback rather than blocking server creation.
 */

export interface VersionOption {
  id: string;
  label: string;
  /** Snapshots / pre-releases / betas are hidden behind a toggle. */
  unstable: boolean;
  releasedAt?: string;
}

const HOUR = 3600;

async function getJson<T>(url: string, revalidate = HOUR): Promise<T | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate },
      headers: { "user-agent": "Pack.Host/1.0 (+https://pack.host)" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Used whenever an upstream API is unreachable. Deliberately short — it only
// has to keep the wizard usable until the upstream recovers.
const FALLBACK = [
  "1.21.9", "1.21.8", "1.21.4", "1.21.1", "1.20.6", "1.20.4", "1.20.1",
  "1.19.4", "1.19.2", "1.18.2", "1.17.1", "1.16.5", "1.12.2", "1.8.9",
];

function plain(ids: string[], unstable = false): VersionOption[] {
  return ids.map((id) => ({ id, label: id, unstable }));
}

async function mojangVersions(): Promise<VersionOption[]> {
  const data = await getJson<{
    versions: { id: string; type: string; releaseTime: string }[];
  }>("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json");
  if (!data) return plain(FALLBACK);
  return data.versions.map((v) => ({
    id: v.id,
    label: v.id,
    unstable: v.type !== "release",
    releasedAt: v.releaseTime,
  }));
}

async function paperProjectVersions(project: string): Promise<VersionOption[]> {
  const data = await getJson<{ versions: string[] }>(
    `https://api.papermc.io/v2/projects/${project}`,
  );
  if (!data?.versions?.length) return plain(FALLBACK);
  return plain([...data.versions].reverse()).map((v) => ({
    ...v,
    unstable: /pre|rc|snapshot|w\d\d[a-z]/i.test(v.id),
  }));
}

async function purpurVersions(): Promise<VersionOption[]> {
  const data = await getJson<{ versions: string[] }>("https://api.purpurmc.org/v2/purpur");
  if (!data?.versions?.length) return paperProjectVersions("paper");
  return plain([...data.versions].reverse());
}

async function fabricVersions(): Promise<VersionOption[]> {
  const data = await getJson<{ version: string; stable: boolean }[]>(
    "https://meta.fabricmc.net/v2/versions/game",
  );
  if (!data?.length) return plain(FALLBACK);
  return data.map((v) => ({ id: v.version, label: v.version, unstable: !v.stable }));
}

async function quiltVersions(): Promise<VersionOption[]> {
  const data = await getJson<{ version: string; stable: boolean }[]>(
    "https://meta.quiltmc.org/v3/versions/game",
  );
  if (!data?.length) return fabricVersions();
  return data.map((v) => ({ id: v.version, label: v.version, unstable: !v.stable }));
}

async function forgeVersions(): Promise<VersionOption[]> {
  const data = await getJson<{ promos: Record<string, string> }>(
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
  );
  if (!data?.promos) return plain(FALLBACK);
  const seen = new Set<string>();
  for (const key of Object.keys(data.promos)) seen.add(key.split("-")[0]);
  return plain([...seen].sort(compareVersionsDesc));
}

async function neoforgeVersions(): Promise<VersionOption[]> {
  const data = await getJson<{ versions: string[] }>(
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
  );
  if (!data?.versions?.length) return plain(["1.21.9", "1.21.8", "1.21.4", "1.21.1", "1.20.6", "1.20.4"]);
  // NeoForge versions are <minor>.<patch>.<build>, mapping to Minecraft 1.<minor>.<patch>.
  const games = new Set<string>();
  for (const v of data.versions) {
    const [minor, patch] = v.split(".");
    if (!minor || !patch) continue;
    games.add(patch === "0" ? `1.${minor}` : `1.${minor}.${patch}`);
  }
  return plain([...games].sort(compareVersionsDesc));
}

async function bedrockVersions(): Promise<VersionOption[]> {
  // Mojang publishes no machine-readable index for BDS, so the agent resolves
  // LATEST/PREVIEW itself and we pin known-good builds alongside.
  return [
    { id: "LATEST", label: "Latest release", unstable: false },
    { id: "PREVIEW", label: "Preview (beta)", unstable: true },
    ...plain(["1.21.130", "1.21.120", "1.21.100", "1.21.93", "1.21.80", "1.21.62", "1.21.51", "1.20.81"]),
  ];
}

/** Highest first: 1.21.9 > 1.21.10 is wrong, so compare numerically per part. */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function versionsFor(software: ServerSoftware): Promise<VersionOption[]> {
  switch (software) {
    case "vanilla":
    case "spigot":
    case "pufferfish":
      return mojangVersions();
    case "paper":
      return paperProjectVersions("paper");
    case "folia":
      return paperProjectVersions("folia");
    case "velocity":
      return paperProjectVersions("velocity");
    case "waterfall":
      return paperProjectVersions("waterfall");
    case "bungeecord":
      return [{ id: "latest", label: "Latest build", unstable: false }];
    case "purpur":
      return purpurVersions();
    case "fabric":
      return fabricVersions();
    case "quilt":
      return quiltVersions();
    case "forge":
      return forgeVersions();
    case "neoforge":
      return neoforgeVersions();
    case "bedrock":
      return bedrockVersions();
    case "pocketmine":
    case "nukkit":
      return [{ id: "latest", label: "Latest build", unstable: false }];
    default:
      return mojangVersions();
  }
}
