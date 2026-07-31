import { ApiError, handler, logEvent, ok, readJson, serverContext } from "@/lib/api";
import { accessSchema, firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Who else can manage this server. */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  const { data, error } = await ctx.supabase
    .from("server_access")
    .select("role, created_at, user_id, profiles:user_id (username, display_name, avatar_url)")
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

  if (!profile) throw new ApiError("No Pack.Host account with that username.", 404);
  if (profile.id === ctx.user.id) throw new ApiError("You already own this server.");

  const { error } = await ctx.supabase.from("server_access").upsert(
    { server_id: id, user_id: profile.id, role: parsed.data.role },
    { onConflict: "server_id,user_id" },
  );

  if (error) throw new ApiError(error.message, 500);

  await logEvent(ctx.admin, id, ctx.user.id, "access.grant", `${profile.username} → ${parsed.data.role}`);
  return ok({ granted: true }, 201);
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
