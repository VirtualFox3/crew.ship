import { handler, ok } from "@/lib/api";
import { searchCatalog } from "@/lib/catalog";
import type { AddonKind } from "@/lib/types";

// Reads query params. Upstream search results are cached for 5 minutes by the
// fetch calls in lib/catalog.ts.
export const dynamic = "force-dynamic";

/** Plugin / mod search across Modrinth, Hangar and SpigotMC. */
export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;

  const source = (params.get("source") ?? "modrinth") as "modrinth" | "hangar" | "spigot";
  const kind = (params.get("kind") ?? "plugin") as AddonKind;

  const items = await searchCatalog(source, {
    q: params.get("q") ?? undefined,
    kind,
    loader: params.get("loader") ?? undefined,
    gameVersion: params.get("version") ?? undefined,
    limit: Math.min(Number(params.get("limit") ?? 24), 50),
    offset: Math.max(Number(params.get("offset") ?? 0), 0),
  });

  return ok({ items });
});
