import { ApiError, handler, logEvent, ok, readJson, serverContext } from "@/lib/api";
import { startServer, stopServer } from "@/lib/provision";
import { firstIssue, powerSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
// Cold-starting a modded server can take a while.
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await serverContext(id, { manage: true });

  const parsed = powerSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(firstIssue(parsed.error));
  const { action } = parsed.data;

  const busy = ["preparing", "starting", "stopping"].includes(ctx.server.status);
  if (busy && action !== "kill") {
    throw new ApiError(`Server is ${ctx.server.status}. Wait for it to settle.`, 409);
  }

  switch (action) {
    case "start": {
      if (ctx.server.status === "online") {
        throw new ApiError("Server is already online.", 409);
      }
      const result = await startServer(ctx.admin, ctx.server);
      await logEvent(ctx.admin, id, ctx.user.id, "power.start", result.status);
      return ok(result);
    }

    case "stop": {
      if (ctx.server.status === "offline") {
        throw new ApiError("Server is already offline.", 409);
      }
      await stopServer(ctx.admin, ctx.server, ctx.node);
      await logEvent(ctx.admin, id, ctx.user.id, "power.stop");
      return ok({ status: "offline" });
    }

    case "kill": {
      await stopServer(ctx.admin, ctx.server, ctx.node, { force: true });
      await logEvent(ctx.admin, id, ctx.user.id, "power.kill");
      return ok({ status: "offline" });
    }

    case "restart": {
      await stopServer(ctx.admin, ctx.server, ctx.node).catch(() => {});
      // Re-read: stopServer clears the port reservation bookkeeping.
      const { data: fresh } = await ctx.admin
        .from("servers")
        .select("*")
        .eq("id", id)
        .single();
      const result = await startServer(ctx.admin, fresh);
      await logEvent(ctx.admin, id, ctx.user.id, "power.restart");
      return ok(result);
    }
  }
});
