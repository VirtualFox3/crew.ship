import type { AddonKind, CatalogItem } from "./types";

/**
 * Add-on catalogue.
 *
 * Modrinth is the primary index (open API, no key) and covers plugins, mods,
 * datapacks and modpacks. Hangar adds PaperMC-first plugins and Spiget exposes
 * SpigotMC. There is no install cap anywhere in this file — "unlimited plugins"
 * is a property of the system, not a plan.
 */

const UA = { "user-agent": "Pack.Host/1.0 (+https://pack.host)" };

export interface CatalogQuery {
  q?: string;
  kind: AddonKind;
  loader?: string;
  gameVersion?: string;
  limit?: number;
  offset?: number;
}

export interface ResolvedVersion {
  versionId: string;
  versionName: string;
  filename: string;
  downloadUrl: string;
  /** Modrinth project ids of hard dependencies we should pull in too. */
  dependencies: string[];
}

// ---------------------------------------------------------------------------
// Modrinth
// ---------------------------------------------------------------------------

const MODRINTH = "https://api.modrinth.com/v2";

function modrinthProjectType(kind: AddonKind): string {
  switch (kind) {
    case "plugin":
      return "plugin";
    case "mod":
      return "mod";
    case "datapack":
      return "datapack";
    case "modpack":
      return "modpack";
    case "resourcepack":
      return "resourcepack";
  }
}

export async function searchModrinth(query: CatalogQuery): Promise<CatalogItem[]> {
  const facets: string[][] = [[`project_type:${modrinthProjectType(query.kind)}`]];
  if (query.loader) facets.push([`categories:${query.loader}`]);
  if (query.gameVersion) facets.push([`versions:${query.gameVersion}`]);

  const params = new URLSearchParams({
    query: query.q ?? "",
    facets: JSON.stringify(facets),
    limit: String(query.limit ?? 24),
    offset: String(query.offset ?? 0),
    index: query.q ? "relevance" : "downloads",
  });

  try {
    const res = await fetch(`${MODRINTH}/search?${params}`, {
      headers: UA,
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits: ModrinthHit[] };
    return data.hits.map(
      (h): CatalogItem => ({
        source: "modrinth",
        projectId: h.project_id,
        slug: h.slug,
        name: h.title,
        summary: h.description,
        author: h.author,
        iconUrl: h.icon_url || null,
        downloads: h.downloads,
        followers: h.follows,
        categories: h.categories ?? [],
        loaders: h.categories ?? [],
        gameVersions: h.versions ?? [],
        pageUrl: `https://modrinth.com/${h.project_type}/${h.slug}`,
      }),
    );
  } catch {
    return [];
  }
}

interface ModrinthHit {
  project_id: string;
  project_type: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string;
  downloads: number;
  follows: number;
  categories: string[];
  versions: string[];
}

interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: string;
  date_published: string;
  files: { url: string; filename: string; primary: boolean }[];
  dependencies: { project_id: string | null; dependency_type: string }[];
}

/**
 * Pick the newest file that actually matches the server. Falls back through
 * loader-only, then game-version-only, then newest — a slightly-off build the
 * user can try beats a dead end.
 */
export async function resolveModrinthVersion(
  projectId: string,
  loader?: string,
  gameVersion?: string,
): Promise<ResolvedVersion | null> {
  try {
    const res = await fetch(`${MODRINTH}/project/${projectId}/version`, {
      headers: UA,
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const versions = (await res.json()) as ModrinthVersion[];
    if (!versions.length) return null;

    const matches = (v: ModrinthVersion, checkLoader: boolean, checkGame: boolean) =>
      (!checkLoader || !loader || v.loaders.includes(loader)) &&
      (!checkGame || !gameVersion || v.game_versions.includes(gameVersion));

    const picked =
      versions.find((v) => matches(v, true, true)) ??
      versions.find((v) => matches(v, true, false)) ??
      versions.find((v) => matches(v, false, true)) ??
      versions[0];

    const file = picked.files.find((f) => f.primary) ?? picked.files[0];
    if (!file) return null;

    return {
      versionId: picked.id,
      versionName: picked.version_number,
      filename: file.filename,
      downloadUrl: file.url,
      dependencies: picked.dependencies
        .filter((d) => d.dependency_type === "required" && d.project_id)
        .map((d) => d.project_id as string),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hangar (PaperMC)
// ---------------------------------------------------------------------------

const HANGAR = "https://hangar.papermc.io/api/v1";

export async function searchHangar(query: CatalogQuery): Promise<CatalogItem[]> {
  const params = new URLSearchParams({
    limit: String(query.limit ?? 24),
    offset: String(query.offset ?? 0),
    sort: query.q ? "-stars" : "-downloads",
  });
  if (query.q) params.set("q", query.q);
  if (query.gameVersion) params.set("version", query.gameVersion);

  try {
    const res = await fetch(`${HANGAR}/projects?${params}`, {
      headers: UA,
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { result: HangarProject[] };
    return (data.result ?? []).map(
      (p): CatalogItem => ({
        source: "hangar",
        projectId: `${p.namespace.owner}/${p.namespace.slug}`,
        slug: p.namespace.slug,
        name: p.name,
        summary: p.description,
        author: p.namespace.owner,
        iconUrl: p.avatarUrl || null,
        downloads: p.stats?.downloads ?? 0,
        followers: p.stats?.stars ?? 0,
        categories: p.category ? [p.category] : [],
        loaders: ["paper"],
        gameVersions: [],
        pageUrl: `https://hangar.papermc.io/${p.namespace.owner}/${p.namespace.slug}`,
      }),
    );
  } catch {
    return [];
  }
}

interface HangarProject {
  name: string;
  description: string;
  category: string;
  avatarUrl: string;
  namespace: { owner: string; slug: string };
  stats: { downloads: number; stars: number };
}

export async function resolveHangarVersion(
  projectId: string,
): Promise<ResolvedVersion | null> {
  const [owner, slug] = projectId.split("/");
  if (!owner || !slug) return null;
  try {
    const res = await fetch(`${HANGAR}/projects/${owner}/${slug}/versions?limit=1`, {
      headers: UA,
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result: { name: string }[] };
    const version = data.result?.[0];
    if (!version) return null;
    return {
      versionId: version.name,
      versionName: version.name,
      filename: `${slug}-${version.name}.jar`.replace(/[^\w.-]/g, "_"),
      downloadUrl: `${HANGAR}/projects/${owner}/${slug}/versions/${encodeURIComponent(
        version.name,
      )}/PAPER/download`,
      dependencies: [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SpigotMC (via the community Spiget API)
// ---------------------------------------------------------------------------

const SPIGET = "https://api.spiget.org/v2";

export async function searchSpigot(query: CatalogQuery): Promise<CatalogItem[]> {
  const size = query.limit ?? 24;
  const page = Math.floor((query.offset ?? 0) / size) + 1;
  const path = query.q
    ? `/search/resources/${encodeURIComponent(query.q)}?size=${size}&page=${page}&sort=-downloads&fields=id,name,tag,icon,downloads,rating,author,testedVersions,external`
    : `/resources/free?size=${size}&page=${page}&sort=-downloads&fields=id,name,tag,icon,downloads,rating,author,testedVersions,external`;

  try {
    const res = await fetch(`${SPIGET}${path}`, { headers: UA, next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = (await res.json()) as SpigetResource[];
    return data
      // External resources live off-site; we cannot fetch a jar for them.
      .filter((r) => !r.external)
      .map(
        (r): CatalogItem => ({
          source: "spigot",
          projectId: String(r.id),
          slug: String(r.id),
          name: r.name,
          summary: r.tag,
          author: String(r.author?.id ?? ""),
          iconUrl: r.icon?.url ? `https://www.spigotmc.org/${r.icon.url}` : null,
          downloads: r.downloads ?? 0,
          followers: Math.round((r.rating?.average ?? 0) * 100) / 100,
          categories: [],
          loaders: ["spigot", "paper"],
          gameVersions: r.testedVersions ?? [],
          pageUrl: `https://www.spigotmc.org/resources/${r.id}`,
        }),
      );
  } catch {
    return [];
  }
}

interface SpigetResource {
  id: number;
  name: string;
  tag: string;
  external: boolean;
  downloads: number;
  icon?: { url: string };
  rating?: { average: number };
  author?: { id: number };
  testedVersions?: string[];
}

export async function resolveSpigotVersion(
  projectId: string,
  name: string,
): Promise<ResolvedVersion | null> {
  return {
    versionId: "latest",
    versionName: "latest",
    filename: `${name.replace(/[^\w.-]/g, "_")}-${projectId}.jar`,
    downloadUrl: `${SPIGET}/resources/${projectId}/download`,
    dependencies: [],
  };
}

// ---------------------------------------------------------------------------

export async function searchCatalog(
  source: "modrinth" | "hangar" | "spigot",
  query: CatalogQuery,
): Promise<CatalogItem[]> {
  if (source === "hangar") return searchHangar(query);
  if (source === "spigot") return searchSpigot(query);
  return searchModrinth(query);
}
