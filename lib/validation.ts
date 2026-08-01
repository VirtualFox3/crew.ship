import { z } from "zod";
import { SOFTWARE } from "@/lib/software";
import { CAPABILITIES } from "@/lib/permissions";

const softwareIds = SOFTWARE.map((s) => s.id) as [string, ...string[]];

// Reserved so nobody can claim an address that collides with our own infra.
const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "app", "panel", "admin", "node", "nodes", "agent", "status",
  "mail", "smtp", "ftp", "cdn", "static", "docs", "blog", "support", "help",
  "pack", "host", "packhost", "mc", "play", "test", "staging", "dev",
]);

export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters.")
  .max(32, "At most 32 characters.")
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Letters, numbers and hyphens only.")
  .refine((v) => !v.includes("--"), "No double hyphens.")
  .refine((v) => !RESERVED_SUBDOMAINS.has(v), "That address is reserved.");

export const createServerSchema = z.object({
  name: z.string().trim().min(1, "Give your server a name.").max(48),
  subdomain: subdomainSchema,
  edition: z.enum(["java", "bedrock", "hybrid"]),
  software: z.enum(softwareIds),
  version: z.string().trim().min(1).max(32),
  memory_mb: z.number().int().min(1024).max(16384).default(4096),
  max_players: z.number().int().min(1).max(1000).default(100),
  crossplay: z.boolean().default(false),
  motd: z.string().max(120).default("A Pack.Host server"),
  gamemode: z.enum(["survival", "creative", "adventure", "spectator"]).default("survival"),
  difficulty: z.enum(["peaceful", "easy", "normal", "hard"]).default("normal"),
  seed: z.string().max(64).optional().nullable(),
  hardcore: z.boolean().default(false),
});

export const updateServerSchema = z
  .object({
    name: z.string().trim().min(1).max(48),
    motd: z.string().max(120),
    gamemode: z.enum(["survival", "creative", "adventure", "spectator"]),
    difficulty: z.enum(["peaceful", "easy", "normal", "hard"]),
    level_type: z.string().max(64),
    seed: z.string().max(64).nullable(),
    pvp: z.boolean(),
    online_mode: z.boolean(),
    whitelist_on: z.boolean(),
    command_blocks: z.boolean(),
    flight: z.boolean(),
    hardcore: z.boolean(),
    crossplay: z.boolean(),
    view_distance: z.number().int().min(3).max(32),
    simulation_distance: z.number().int().min(3).max(32),
    spawn_protection: z.number().int().min(0).max(256),
    max_players: z.number().int().min(1).max(1000),
    memory_mb: z.number().int().min(1024).max(16384),
    auto_stop_minutes: z.number().int().min(0).max(180),
    auto_start: z.boolean(),
    icon_url: z.string().url().nullable(),
    java_flags: z.string().max(512).nullable(),
    // Changing these two reinstalls the server jar on next start.
    software: z.enum(softwareIds),
    version: z.string().trim().min(1).max(32),
  })
  .partial();

export const powerSchema = z.object({
  action: z.enum(["start", "stop", "restart", "kill"]),
});

export const commandSchema = z.object({
  command: z.string().trim().min(1).max(512),
});

export const installAddonSchema = z.object({
  source: z.enum(["modrinth", "hangar", "spigot", "url"]),
  kind: z.enum(["plugin", "mod", "datapack", "modpack", "resourcepack"]),
  projectId: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  slug: z.string().max(160).optional(),
  author: z.string().max(160).optional(),
  iconUrl: z.string().url().nullable().optional(),
  /** Direct URL installs bypass the catalogue entirely. */
  url: z.string().url().optional(),
});

export const playerSchema = z.object({
  list: z.enum(["whitelist", "op", "ban"]),
  username: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[a-zA-Z0-9_.]+$/, "That is not a valid Minecraft username."),
  level: z.number().int().min(1).max(4).optional(),
  reason: z.string().max(200).optional(),
});

export const accessSchema = z.object({
  username: z.string().trim().min(3).max(24),
  role: z.enum(["admin", "moderator", "viewer"]),
  /** Omit to use the role's preset; send a list to grant exactly those. */
  permissions: z
    .array(z.enum(CAPABILITIES))
    .max(CAPABILITIES.length)
    .optional(),
});

/** Changing what an existing member may do, without re-inviting them. */
export const accessUpdateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "moderator", "viewer"]).optional(),
  permissions: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length).optional(),
});

export const fileWriteSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(2_000_000),
});

export const backupSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
});

/** Flattens a ZodError into a single readable sentence for the UI. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request.";
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}
