import { consoleUrl, issueConsoleToken } from "@/lib/agent";
import { handler, ok, requireNode, serverContext } from "@/lib/api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Mints a short-lived ticket for the live console.
 *
 * The browser opens the WebSocket directly against the node — serverless
 * functions cannot hold a long-lived socket, and proxying logs through one
 * would add latency to every line.
 */
export const POST = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);
  const node = requireNode(ctx);

  const token = issueConsoleToken(id);

  return ok({
    url: consoleUrl(node, id, token),
    expiresIn: 900,
    canSendCommands: ctx.server.owner_id === ctx.user.id,
  });
});
