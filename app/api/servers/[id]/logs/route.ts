import { agentFetch } from "@/lib/agent";
import { handler, ok, serverContext } from "@/lib/api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Recent console output. Used to backfill the console before the socket opens. */
export const GET = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { require: "console" });

  const lines = Number(new URL(request.url).searchParams.get("lines") ?? 200);

  if (!ctx.node) return ok({ lines: [] as string[] });

  try {
    const data = await agentFetch<{ lines: string[] }>(
      ctx.node,
      `/servers/${id}/logs?lines=${Math.min(Math.max(lines, 1), 1000)}`,
      { timeoutMs: 10_000 },
    );
    return ok(data);
  } catch {
    return ok({ lines: [] as string[] });
  }
});
