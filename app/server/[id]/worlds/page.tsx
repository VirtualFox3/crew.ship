import { notFound } from "next/navigation";
import { WorldManager } from "@/components/world-manager";
import { createClient } from "@/lib/supabase/server";
import type { Server } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WorldsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: server } = await supabase
    .from("servers")
    .select("status, seed")
    .eq("id", id)
    .maybeSingle();

  if (!server) notFound();
  const s = server as Server;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Worlds</h2>
        <p className="mt-1 text-sm text-ink-400">
          Switch between generated worlds or start fresh from a seed.
        </p>
      </div>
      <WorldManager serverId={id} offline={s.status === "offline"} currentSeed={s.seed} />
    </div>
  );
}
