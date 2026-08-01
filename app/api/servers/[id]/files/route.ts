import { agentFetch } from "@/lib/agent";
import { ApiError, handler, logEvent, ok, readJson, requireNode, serverContext } from "@/lib/api";
import { fileWriteSchema, firstIssue } from "@/lib/validation";
import type { FileEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * File manager. Path traversal is rejected here and again on the node, which
 * jails every path inside the server's own volume.
 */
function safePath(input: string | null): string {
  const path = (input ?? "").replace(/^\/+/, "");
  if (path.split("/").includes("..")) throw new ApiError("Invalid path.");
  return path;
}

export const GET = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);
  const node = requireNode(ctx);

  const url = new URL(request.url);
  const path = safePath(url.searchParams.get("path"));
  const read = url.searchParams.get("read") === "1";

  if (read) {
    const data = await agentFetch<{ content: string; truncated: boolean }>(
      node,
      `/servers/${id}/files/read?path=${encodeURIComponent(path)}`,
      { timeoutMs: 20_000 },
    );
    return ok(data);
  }

  const data = await agentFetch<{ entries: FileEntry[] }>(
    node,
    `/servers/${id}/files?path=${encodeURIComponent(path)}`,
    { timeoutMs: 20_000 },
  );
  return ok(data);
});

export const PUT = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });
  const node = requireNode(ctx);

  const parsed = fileWriteSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));

  const path = safePath(parsed.data.path);
  await agentFetch(node, `/servers/${id}/files/write`, {
    method: "POST",
    body: { path, content: parsed.data.content },
    timeoutMs: 30_000,
  });

  await logEvent(ctx.admin, id, ctx.user.id, "file.write", path);
  return ok({ saved: true });
});

export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });
  const node = requireNode(ctx);

  const path = safePath(new URL(request.url).searchParams.get("path"));
  if (!path) throw new ApiError("Refusing to delete the server root.");

  await agentFetch(node, `/servers/${id}/files`, { method: "DELETE", body: { path } });
  await logEvent(ctx.admin, id, ctx.user.id, "file.delete", path);
  return ok({ deleted: true });
});

/** Creates a directory or an empty file. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });
  const node = requireNode(ctx);

  const body = await readJson<{ path?: string; directory?: boolean }>(request);
  const path = safePath(body.path ?? null);
  if (!path) throw new ApiError("Give the new item a name.");

  await agentFetch(node, `/servers/${id}/files/create`, {
    method: "POST",
    body: { path, directory: Boolean(body.directory) },
  });

  return ok({ created: true }, 201);
});
