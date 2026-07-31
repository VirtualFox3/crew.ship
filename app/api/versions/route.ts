import { handler, ok } from "@/lib/api";
import { versionsFor } from "@/lib/versions";
import { SOFTWARE } from "@/lib/software";
import type { ServerSoftware } from "@/lib/types";

// Reads a query param, so it cannot be prerendered. The upstream fetches
// inside versionsFor() carry their own one-hour cache.
export const dynamic = "force-dynamic";

/** Live version catalogue for the create-server wizard. */
export const GET = handler(async (request: Request) => {
  const software = new URL(request.url).searchParams.get("software") as ServerSoftware | null;
  if (!software || !SOFTWARE.some((s) => s.id === software)) {
    return ok({ versions: [] });
  }
  return ok({ versions: await versionsFor(software) });
});
