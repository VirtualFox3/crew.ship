import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AgentError } from "@/lib/agent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { permissionsFor, type Capability } from "@/lib/permissions";
import type { AccessRole, Node, Server } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Wraps a route handler so every failure becomes a consistent JSON body.
 * Unexpected errors are logged but never leaked to the client.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof AgentError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("[api]", err);
      const message =
        err instanceof Error && /Missing [A-Z_]+/.test(err.message)
          ? err.message
          : "Unexpected server error.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export async function requireUser(): Promise<{
  user: User;
  supabase: SupabaseClient;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError("You need to be signed in.", 401);
  return { user, supabase };
}

export interface ServerContext {
  user: User;
  supabase: SupabaseClient;
  admin: SupabaseClient;
  server: Server;
  node: Node | null;
  /** Everything the caller may do here. Owners hold all of it. */
  permissions: Capability[];
}

/**
 * Loads a server the caller may touch, and works out what they may do with it.
 *
 * RLS already restricts reads to owned and shared servers, so a miss here is
 * genuinely a 404 for this user. `require` then names the single capability
 * this route needs — "files", "settings", and so on — which keeps the
 * permission next to the operation instead of in a tier lookup somewhere else.
 */
export async function serverContext(
  serverId: string,
  { require: required }: { require?: Capability } = {},
): Promise<ServerContext> {
  const { user, supabase } = await requireUser();

  const { data: server } = await supabase
    .from("servers")
    .select("*")
    .eq("id", serverId)
    .maybeSingle();

  if (!server) throw new ApiError("Server not found.", 404);

  let permissions: Capability[];

  if (server.owner_id === user.id) {
    permissions = permissionsFor("owner");
  } else {
    const { data: access } = await supabase
      .from("server_access")
      .select("role, permissions")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle();

    permissions = access
      ? permissionsFor(access.role as AccessRole, access.permissions)
      : [];
  }

  if (required && !permissions.includes(required)) {
    const label =
      CAPABILITY_LABELS[required] ?? required;
    throw new ApiError(
      `You do not have permission to ${label} on this server. Ask the owner.`,
      403,
    );
  }

  // Owner-scoped operations do not need a service-role key. RLS restricts the
  // caller to their own servers and host computers, which is also what makes
  // self-hosting work on a fresh deployment without privileged credentials.
  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    admin = supabase;
  }
  let node: Node | null = null;
  if (server.node_id) {
    const { data } = await admin.from("nodes").select("*").eq("id", server.node_id).maybeSingle();
    node = (data as Node | null) ?? null;
  }

  return { user, supabase, admin, server: server as Server, node, permissions };
}

/** Phrased to complete "You do not have permission to ...". */
const CAPABILITY_LABELS: Record<Capability, string> = {
  console: "view the console",
  command: "run commands",
  power: "start or stop the server",
  players: "manage players",
  addons: "manage plugins and mods",
  files: "manage files",
  backups: "manage backups",
  worlds: "manage worlds",
  settings: "change settings",
};

/** A node is required for anything that touches the running container. */
export function requireNode(ctx: ServerContext): Node {
  if (!ctx.node) {
    throw new ApiError(
      "This server has not been placed on a node yet. Start it first.",
      409,
    );
  }
  return ctx.node;
}

export async function logEvent(
  admin: SupabaseClient,
  serverId: string,
  actorId: string | null,
  action: string,
  detail?: string,
) {
  await admin.from("server_events").insert({
    server_id: serverId,
    actor_id: actorId,
    action,
    detail: detail ?? null,
  });
}

/** Parses a JSON body, rejecting anything that is not an object. */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new Error();
    return body as T;
  } catch {
    throw new ApiError("Expected a JSON body.");
  }
}
