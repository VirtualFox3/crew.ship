export type ServerStatus =
  | "offline"
  | "queued"
  | "preparing"
  | "starting"
  | "online"
  | "stopping"
  | "crashed";

export type ServerEdition = "java" | "bedrock" | "hybrid";

export type ServerSoftware =
  | "vanilla"
  | "paper"
  | "purpur"
  | "spigot"
  | "folia"
  | "pufferfish"
  | "fabric"
  | "forge"
  | "neoforge"
  | "quilt"
  | "velocity"
  | "bungeecord"
  | "waterfall"
  | "bedrock";

/** CPU architecture of a node. Not every server software runs on both. */
export type NodeArch = "x64" | "arm64";

export type AddonKind = "plugin" | "mod" | "datapack" | "modpack" | "resourcepack";
export type AddonSource = "modrinth" | "hangar" | "spigot" | "curseforge" | "url" | "upload";
export type PlayerList = "whitelist" | "op" | "ban";
export type AccessRole = "owner" | "admin" | "moderator" | "viewer";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  minecraft_uuid: string | null;
  timezone: string;
  server_limit: number;
  created_at: string;
}

export interface Node {
  id: string;
  owner_id: string;
  name: string;
  region: string;
  arch: NodeArch;
  agent_url: string;
  public_host: string;
  /** Relay hostname when the node is behind a tunnel (playit.gg etc). */
  tunnel_host: string | null;
  /** Node-local port -> relay-published port. */
  tunnel_ports: Record<string, number>;
  status: "online" | "draining" | "offline";
  max_servers: number;
  max_memory_mb: number;
  used_memory_mb: number;
  running_count: number;
  port_range_start: number;
  port_range_end: number;
  last_heartbeat: string | null;
}

export interface Server {
  id: string;
  owner_id: string;
  node_id: string | null;
  name: string;
  subdomain: string;
  custom_domain: string | null;
  edition: ServerEdition;
  software: ServerSoftware;
  version: string;
  build: string | null;
  status: ServerStatus;
  status_detail: string | null;
  memory_mb: number;
  max_players: number;
  cpu_cores: number;
  storage_mb: number;
  java_port: number | null;
  bedrock_port: number | null;
  motd: string;
  gamemode: string;
  difficulty: string;
  seed: string | null;
  level_type: string;
  pvp: boolean;
  online_mode: boolean;
  whitelist_on: boolean;
  command_blocks: boolean;
  flight: boolean;
  view_distance: number;
  simulation_distance: number;
  hardcore: boolean;
  spawn_protection: number;
  crossplay: boolean;
  icon_url: string | null;
  auto_stop_minutes: number;
  auto_start: boolean;
  java_flags: string | null;
  players_online: number;
  queue_position: number | null;
  last_online_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerAddon {
  id: string;
  server_id: string;
  kind: AddonKind;
  source: AddonSource;
  project_id: string | null;
  version_id: string | null;
  name: string;
  slug: string | null;
  author: string | null;
  icon_url: string | null;
  filename: string;
  download_url: string | null;
  version_name: string | null;
  enabled: boolean;
  installed_at: string;
}

export interface ServerPlayer {
  id: string;
  server_id: string;
  list: PlayerList;
  username: string;
  uuid: string | null;
  level: number | null;
  reason: string | null;
  created_at: string;
}

export interface Backup {
  id: string;
  server_id: string;
  name: string;
  filename: string;
  size_bytes: number;
  automatic: boolean;
  created_at: string;
}

/** A file or directory entry returned by the agent's file manager. */
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modified: string;
  mode: string;
}

/** A search result from Modrinth / Hangar / Spiget, normalised. */
export interface CatalogItem {
  source: AddonSource;
  projectId: string;
  slug: string;
  name: string;
  summary: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  followers: number;
  categories: string[];
  loaders: string[];
  gameVersions: string[];
  pageUrl: string;
}
