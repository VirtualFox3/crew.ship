import { agentFetch } from "@/lib/agent";
import { ApiError, handler, logEvent, ok, readJson, requireNode, serverContext } from "@/lib/api";
import { commandSchema, firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Sends a console command over RCON via the node. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { require: "command" });

  const parsed = commandSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));

  if (ctx.server.status !== "online") {
    throw new ApiError("The server has to be online to accept commands.", 409);
  }

  const node = requireNode(ctx);
  const result = await agentFetch<{ output: string }>(node, `/servers/${id}/command`, {
    method: "POST",
    body: { command: parsed.data.command },
    timeoutMs: 15_000,
  });

  await logEvent(ctx.admin, id, ctx.user.id, "console.command", parsed.data.command.slice(0, 180));

  return ok(result);
});
