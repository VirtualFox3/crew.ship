import { agentFetch } from "@/lib/agent";
import { ApiError, handler, logEvent, ok, readJson, requireNode, serverContext } from "@/lib/api";
import { backupSchema, firstIssue } from "@/lib/validation";
import type { Backup } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);

  const { data, error } = await ctx.supabase
    .from("backups")
    .select("*")
    .eq("server_id", id)
    .order("created_at", { ascending: false });

  if (error) throw new ApiError(error.message, 500);
  return ok({ backups: (data as Backup[]) ?? [] });
});

/** Snapshots the whole server directory on the node. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });
  const node = requireNode(ctx);

  const parsed = backupSchema.safeParse(await readJson(request).catch(() => ({})));
  const name =
    (parsed.success ? parsed.data.name : undefined) ??
    `Backup ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

  const result = await agentFetch<{ filename: string; sizeBytes: number }>(
    node,
    `/servers/${id}/backups`,
    { method: "POST", body: { name }, timeoutMs: 180_000 },
  );

  const { data, error } = await ctx.supabase
    .from("backups")
    .insert({
      server_id: id,
      name,
      filename: result.filename,
      size_bytes: result.sizeBytes,
    })
    .select()
    .single();

  if (error) throw new ApiError(error.message, 500);

  await logEvent(ctx.admin, id, ctx.user.id, "backup.create", name);
  return ok({ backup: data }, 201);
});

/** Restores a snapshot. The server must be offline so the world is not in use. */
export const PUT = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });
  const node = requireNode(ctx);

  if (ctx.server.status !== "offline") {
    throw new ApiError("Stop the server before restoring a backup.", 409);
  }

  const body = await readJson<{ backup?: string }>(request);
  if (!body.backup) throw new ApiError("Missing backup id.");

  const { data: backup } = await ctx.supabase
    .from("backups")
    .select("*")
    .eq("id", body.backup)
    .eq("server_id", id)
    .maybeSingle();

  if (!backup) throw new ApiError("Backup not found.", 404);

  await agentFetch(node, `/servers/${id}/backups/restore`, {
    method: "POST",
    body: { filename: backup.filename },
    timeoutMs: 180_000,
  });

  await logEvent(ctx.admin, id, ctx.user.id, "backup.restore", backup.name);
  return ok({ restored: true });
});

export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });

  const backupId = new URL(request.url).searchParams.get("backup");
  if (!backupId) throw new ApiError("Missing backup id.");

  const { data: backup } = await ctx.supabase
    .from("backups")
    .select("*")
    .eq("id", backupId)
    .eq("server_id", id)
    .maybeSingle();

  if (!backup) throw new ApiError("Backup not found.", 404);

  if (ctx.node) {
    await agentFetch(ctx.node, `/servers/${id}/backups`, {
      method: "DELETE",
      body: { filename: backup.filename },
    }).catch(() => {});
  }

  await ctx.supabase.from("backups").delete().eq("id", backupId);
  return ok({ deleted: true });
});
