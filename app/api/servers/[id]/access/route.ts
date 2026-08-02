import { ApiError, handler, logEvent, ok, readJson, serverContext } from "@/lib/api";
import { accessSchema, accessUpdateSchema, firstIssue } from "@/lib/validation";
import { permissionsFor } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Who else can manage this server. */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  const { data, error } = await ctx.supabase
    .from("server_access")
    .select("role, permissions, created_at, user_id, profiles:user_id (username, display_name, avatar_url)")
    .eq("server_id", id);

  if (error) throw new ApiError(error.message, 500);
  return ok({ members: data ?? [] });
});

export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  if (ctx.server.owner_id !== ctx.user.id) {
    throw new ApiError("Only the owner can invite people.", 403);
  }

  const parsed = accessSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));

  const { data: profile } = await ctx.supabase
    .from("profiles")
    .select("id, username")
    .ilike("username", parsed.data.username)
    .maybeSingle();

  if (!profile) throw new ApiError("No Howl.Host account with that username.", 404);
  if (profile.id === ctx.user.id) throw new ApiError("You already own this server.");

  // An explicit list wins; otherwise store the role's preset so what the owner
  // saw in the picker is exactly what gets written.
  const permissions = parsed.data.permissions ?? permissionsFor(parsed.data.role);

  const { error } = await ctx.supabase.from("server_access").upsert(
    { server_id: id, user_id: profile.id, role: parsed.data.role, permissions },
    { onConflict: "server_id,user_id" },
  );

  if (error) throw new ApiError(error.message, 500);

  await logEvent(
    ctx.admin,
    id,
    ctx.user.id,
    "access.grant",
    `${profile.username} → ${permissions.join(", ") || "no access"}`,
  );
  return ok({ granted: true, permissions }, 201);
});

/** Change what an existing member may do, without removing and re-inviting. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  if (ctx.server.owner_id !== ctx.user.id) {
    throw new ApiError("Only the owner can change permissions.", 403);
  }

  const parsed = accessUpdateSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));
  const { userId, role, permissions } = parsed.data;

  if (userId === ctx.user.id) {
    throw new ApiError("You cannot change your own access as the owner.");
  }

  const patch: Record<string, unknown> = {};
  if (role) patch.role = role;
  // Switching role without an explicit list re-applies that role's preset.
  if (permissions) patch.permissions = permissions;
  else if (role) patch.permissions = permissionsFor(role);

  if (!Object.keys(patch).length) throw new ApiError("Nothing to change.");

  const { error } = await ctx.supabase
    .from("server_access")
    .update(patch)
    .eq("server_id", id)
    .eq("user_id", userId);

  if (error) throw new ApiError(error.message, 500);

  await logEvent(ctx.admin, id, ctx.user.id, "access.update", JSON.stringify(patch));
  return ok({ updated: true });
});

export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  const userId = new URL(request.url).searchParams.get("user");
  if (!userId) throw new ApiError("Missing user id.");

  // The owner can remove anyone; anyone else may remove only themselves.
  if (ctx.server.owner_id !== ctx.user.id && userId !== ctx.user.id) {
    throw new ApiError("Only the owner can remove other people.", 403);
  }

  await ctx.supabase.from("server_access").delete().eq("server_id", id).eq("user_id", userId);
  return ok({ removed: true });
});
