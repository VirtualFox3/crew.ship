import { agentFetch } from "@/lib/agent";
import { ApiError, handler, logEvent, ok, readJson, requireNode, serverContext } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

interface World {
  name: string;
  sizeBytes: number;
  active: boolean;
}

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id);
  if (!ctx.node) return ok({ worlds: [] as World[] });

  const data = await agentFetch<{ worlds: World[] }>(ctx.node, `/servers/${id}/worlds`, {
    timeoutMs: 20_000,
  });
  return ok(data);
});

/** Reset (regenerate) or switch the active world. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { require: "worlds" });
  const node = requireNode(ctx);

  const body = await readJson<{ action?: string; world?: string; seed?: string }>(request);

  if (ctx.server.status !== "offline") {
    throw new ApiError("Stop the server before changing worlds.", 409);
  }

  if (body.action === "reset") {
    await agentFetch(node, `/servers/${id}/worlds/reset`, {
      method: "POST",
      body: { seed: body.seed ?? null },
      timeoutMs: 60_000,
    });
    if (body.seed !== undefined) {
      await ctx.supabase.from("servers").update({ seed: body.seed || null }).eq("id", id);
    }
    await logEvent(ctx.admin, id, ctx.user.id, "world.reset", body.seed || "random seed");
    return ok({ reset: true });
  }

  if (body.action === "activate" && body.world) {
    await agentFetch(node, `/servers/${id}/worlds/activate`, {
      method: "POST",
      body: { world: body.world },
    });
    await logEvent(ctx.admin, id, ctx.user.id, "world.activate", body.world);
    return ok({ activated: body.world });
  }

  throw new ApiError("Unknown world action.");
});
