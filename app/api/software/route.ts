import { handler, ok, requireUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { SOFTWARE, runsOn } from "@/lib/software";
import type { NodeArch } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Server software the fleet can actually run.
 *
 * Rather than hiding incompatible entries outright, each one is returned with
 * an `unavailable` reason so the wizard can grey it out and say why — a silent
 * disappearance would just look like a missing feature.
 */
export const GET = handler(async () => {
  await requireUser();

  let arches: NodeArch[] = [];
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("nodes").select("arch").eq("status", "online");
    arches = [...new Set((data ?? []).map((n) => n.arch as NodeArch))];
  } catch {
    // No service-role key configured yet — offer everything rather than
    // blocking server creation on an infrastructure detail.
    arches = [];
  }

  return ok({
    arches,
    software: SOFTWARE.map((s) => {
      const supported = !arches.length || arches.some((a) => runsOn(s, a));
      return {
        ...s,
        unavailable: supported
          ? null
          : `No ${s.arch?.join(" or ") ?? "compatible"} node is online. ` +
            `${s.name} has no build for this hardware.`,
      };
    }),
  });
});
