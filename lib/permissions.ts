import type { AccessRole } from "@/lib/types";

/**
 * Per-capability access.
 *
 * Roles are presets, not the mechanism. The owner ticks exactly what a person
 * may do, so "can run commands but must not touch files" is expressible rather
 * than forcing a choice between two coarse tiers.
 *
 * Every capability maps to something a person can actually see in the panel,
 * because a permission nobody can point at is a permission nobody can reason
 * about.
 */

export const CAPABILITIES = [
  "console",
  "command",
  "power",
  "players",
  "addons",
  "files",
  "backups",
  "worlds",
  "settings",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilityInfo {
  id: Capability;
  label: string;
  description: string;
  /** Flagged in the UI: these can lose data or cost money. */
  sensitive?: boolean;
}

export const CAPABILITY_INFO: CapabilityInfo[] = [
  {
    id: "console",
    label: "View console",
    description: "Watch live server output and read logs.",
  },
  {
    id: "command",
    label: "Run commands",
    description: "Type into the console — including /op and /ban.",
    sensitive: true,
  },
  {
    id: "power",
    label: "Start and stop",
    description: "Start, stop and restart the server.",
  },
  {
    id: "players",
    label: "Manage players",
    description: "Whitelist, operators and bans.",
  },
  {
    id: "addons",
    label: "Plugins and mods",
    description: "Install, disable and remove add-ons.",
  },
  {
    id: "files",
    label: "Files",
    description: "Browse and edit any file on the server.",
    sensitive: true,
  },
  {
    id: "backups",
    label: "Backups",
    description: "Create, restore and delete backups.",
    sensitive: true,
  },
  {
    id: "worlds",
    label: "Worlds",
    description: "Switch the active world or regenerate it.",
    sensitive: true,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Server options, memory, software and Minecraft version.",
    sensitive: true,
  },
];

/**
 * Starting points for the picker. Chosen to match the behaviour these roles
 * already had, so existing invites keep working exactly as before.
 */
export const ROLE_PRESETS: Record<Exclude<AccessRole, "owner">, Capability[]> = {
  admin: [...CAPABILITIES],
  moderator: ["console", "command", "power", "players", "addons", "files", "backups"],
  viewer: ["console"],
};

/** The owner implicitly holds everything; nothing is stored for them. */
export function permissionsFor(
  role: AccessRole,
  explicit?: string[] | null,
): Capability[] {
  if (role === "owner") return [...CAPABILITIES];
  if (explicit?.length) {
    return explicit.filter((p): p is Capability =>
      (CAPABILITIES as readonly string[]).includes(p),
    );
  }
  return ROLE_PRESETS[role] ?? [];
}

export function can(
  granted: Capability[] | null | undefined,
  capability: Capability,
): boolean {
  return Boolean(granted?.includes(capability));
}

/** Names the preset a set of capabilities matches, for display. */
export function describePermissions(granted: Capability[]): string {
  const sorted = [...granted].sort().join(",");
  for (const [role, preset] of Object.entries(ROLE_PRESETS)) {
    if ([...preset].sort().join(",") === sorted) {
      return role.charAt(0).toUpperCase() + role.slice(1);
    }
  }
  if (!granted.length) return "No access";
  return `Custom · ${granted.length} of ${CAPABILITIES.length}`;
}
