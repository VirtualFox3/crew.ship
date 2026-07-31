import type { ServerEdition, ServerSoftware } from "./types";

export interface SoftwareInfo {
  id: ServerSoftware;
  name: string;
  edition: ServerEdition;
  /** Short pitch shown in the create-server wizard. */
  blurb: string;
  /** What the software can load. Drives which tabs appear on the server page. */
  supports: {
    plugins: boolean;
    mods: boolean;
    datapacks: boolean;
    /** Geyser + Floodgate can be injected so Bedrock clients join a Java server. */
    crossplay: boolean;
  };
  /** TYPE value understood by the itzg/minecraft-server image. */
  agentType: string;
  /** Directory add-ons are dropped into. */
  addonDir: string;
  recommended?: boolean;
  proxy?: boolean;
}

export const SOFTWARE: SoftwareInfo[] = [
  {
    id: "paper",
    name: "Paper",
    edition: "java",
    blurb: "The default. Huge performance gains over vanilla, Bukkit/Spigot plugins, and Geyser crossplay.",
    supports: { plugins: true, mods: false, datapacks: true, crossplay: true },
    agentType: "PAPER",
    addonDir: "plugins",
    recommended: true,
  },
  {
    id: "purpur",
    name: "Purpur",
    edition: "java",
    blurb: "Paper plus hundreds of gameplay toggles. Drop-in compatible with every Paper plugin.",
    supports: { plugins: true, mods: false, datapacks: true, crossplay: true },
    agentType: "PURPUR",
    addonDir: "plugins",
  },
  {
    id: "pufferfish",
    name: "Pufferfish",
    edition: "java",
    blurb: "Paper fork tuned for very high player counts and large redstone builds.",
    supports: { plugins: true, mods: false, datapacks: true, crossplay: true },
    agentType: "PUFFERFISH",
    addonDir: "plugins",
  },
  {
    id: "folia",
    name: "Folia",
    edition: "java",
    blurb: "Regionised multithreading. Built for hundreds of players spread across a world.",
    supports: { plugins: true, mods: false, datapacks: true, crossplay: false },
    agentType: "FOLIA",
    addonDir: "plugins",
  },
  {
    id: "spigot",
    name: "Spigot",
    edition: "java",
    blurb: "The classic plugin platform. Use it when a plugin refuses to run anywhere else.",
    supports: { plugins: true, mods: false, datapacks: true, crossplay: true },
    agentType: "SPIGOT",
    addonDir: "plugins",
  },
  {
    id: "vanilla",
    name: "Vanilla",
    edition: "java",
    blurb: "Exactly what Mojang ships. Datapacks only — no plugins, no mods.",
    supports: { plugins: false, mods: false, datapacks: true, crossplay: false },
    agentType: "VANILLA",
    addonDir: "world/datapacks",
  },
  {
    id: "fabric",
    name: "Fabric",
    edition: "java",
    blurb: "Lightweight mod loader with the fastest updates to new Minecraft versions.",
    supports: { plugins: false, mods: true, datapacks: true, crossplay: true },
    agentType: "FABRIC",
    addonDir: "mods",
    recommended: true,
  },
  {
    id: "forge",
    name: "Forge",
    edition: "java",
    blurb: "The original mod loader. Runs the largest modpacks and legacy mods.",
    supports: { plugins: false, mods: true, datapacks: true, crossplay: false },
    agentType: "FORGE",
    addonDir: "mods",
  },
  {
    id: "neoforge",
    name: "NeoForge",
    edition: "java",
    blurb: "Modern Forge successor for 1.20.2+. Where most new large mods land.",
    supports: { plugins: false, mods: true, datapacks: true, crossplay: false },
    agentType: "NEOFORGE",
    addonDir: "mods",
  },
  {
    id: "quilt",
    name: "Quilt",
    edition: "java",
    blurb: "Fabric-compatible loader with a stricter mod API.",
    supports: { plugins: false, mods: true, datapacks: true, crossplay: false },
    agentType: "QUILT",
    addonDir: "mods",
  },
  {
    id: "bedrock",
    name: "Bedrock (official)",
    edition: "bedrock",
    blurb: "Mojang's Bedrock Dedicated Server. For Windows 10, mobile, console and Switch players.",
    supports: { plugins: false, mods: false, datapacks: false, crossplay: false },
    agentType: "BEDROCK",
    addonDir: "behavior_packs",
    recommended: true,
  },
  {
    id: "pocketmine",
    name: "PocketMine-MP",
    edition: "bedrock",
    blurb: "Bedrock server with a full plugin API. Hundreds of Poggit plugins.",
    supports: { plugins: true, mods: false, datapacks: false, crossplay: false },
    agentType: "POCKETMINE",
    addonDir: "plugins",
  },
  {
    id: "nukkit",
    name: "Nukkit",
    edition: "bedrock",
    blurb: "Java-written Bedrock server. Lightweight with Bukkit-style plugins.",
    supports: { plugins: true, mods: false, datapacks: false, crossplay: false },
    agentType: "NUKKIT",
    addonDir: "plugins",
  },
  {
    id: "velocity",
    name: "Velocity",
    edition: "java",
    blurb: "Modern proxy for linking several servers into one network.",
    supports: { plugins: true, mods: false, datapacks: false, crossplay: true },
    agentType: "VELOCITY",
    addonDir: "plugins",
    proxy: true,
  },
  {
    id: "bungeecord",
    name: "BungeeCord",
    edition: "java",
    blurb: "The long-standing proxy. Widest plugin compatibility for networks.",
    supports: { plugins: true, mods: false, datapacks: false, crossplay: true },
    agentType: "BUNGEECORD",
    addonDir: "plugins",
    proxy: true,
  },
  {
    id: "waterfall",
    name: "Waterfall",
    edition: "java",
    blurb: "BungeeCord fork with Paper's patches. Legacy networks only.",
    supports: { plugins: true, mods: false, datapacks: false, crossplay: true },
    agentType: "WATERFALL",
    addonDir: "plugins",
    proxy: true,
  },
];

export const SOFTWARE_BY_ID = Object.fromEntries(
  SOFTWARE.map((s) => [s.id, s]),
) as Record<ServerSoftware, SoftwareInfo>;

export function softwareInfo(id: ServerSoftware): SoftwareInfo {
  return SOFTWARE_BY_ID[id] ?? SOFTWARE_BY_ID.paper;
}

/** Loader identifier used by Modrinth / Hangar when filtering add-ons. */
export function loaderFor(software: ServerSoftware): string {
  switch (software) {
    case "paper":
    case "purpur":
    case "pufferfish":
    case "folia":
      return "paper";
    case "spigot":
      return "spigot";
    case "fabric":
      return "fabric";
    case "quilt":
      return "quilt";
    case "forge":
      return "forge";
    case "neoforge":
      return "neoforge";
    case "velocity":
      return "velocity";
    case "bungeecord":
    case "waterfall":
      return "bungeecord";
    default:
      return "paper";
  }
}
