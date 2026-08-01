import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AgentError } from "@/lib/agent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Node, Server } from "@/lib/types";

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
}

/**
 * Loads a server the caller may touch.
 *
 * RLS already restricts reads to owned and shared servers, so a miss here is
 * genuinely a 404 for this user. Two further levels sit on top:
 *
 * - `manage`     day-to-day operation: console, players, add-ons, files,
 *                backups, power. Admins and moderators.
 * - `administer` changes the shape of the server: settings, software, version,
 *                worlds. Owner and admins only.
 *
 * The split exists because the invite UI promises moderators cannot change
 * settings, and a permission that is described but not enforced is worse than
 * one that was never offered.
 */
export async function serverContext(
  serverId: string,
  { manage = false, administer = false } = {},
): Promise<ServerContext> {
  const { user, supabase } = await requireUser();

  const { data: server } = await supabase
    .from("servers")
    .select("*")
    .eq("id", serverId)
    .maybeSingle();

  if (!server) throw new ApiError("Server not found.", 404);

  if ((manage || administer) && server.owner_id !== user.id) {
    const { data: access } = await supabase
      .from("server_access")
      .select("role")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle();

    const allowed = administer ? ["admin"] : ["admin", "moderator"];

    if (!access || !allowed.includes(access.role)) {
      throw new ApiError(
        access?.role === "moderator"
          ? "Moderators cannot change server settings. Ask an admin."
          : "You have view-only access to this server.",
        403,
      );
    }
  }

  const admin = createAdminClient();
  let node: Node | null = null;
  if (server.node_id) {
    const { data } = await admin.from("nodes").select("*").eq("id", server.node_id).maybeSingle();
    node = (data as Node | null) ?? null;
  }

  return { user, supabase, admin, server: server as Server, node };
}

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
