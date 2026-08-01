import { notFound } from "next/navigation";
import { PlayerManager } from "@/components/player-manager";
import { agentFetch } from "@/lib/agent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Node, Server, ServerPlayer } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PlayersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: server }, { data: players }] = await Promise.all([
    supabase.from("servers").select("*").eq("id", id).maybeSingle(),
    supabase.from("server_players").select("*").eq("server_id", id),
  ]);

  if (!server) notFound();
  const s = server as Server;

  // Best-effort live roster; the lists below work regardless.
  let online: string[] = [];
  if (s.node_id && s.status === "online") {
    try {
      const { data: node } = await createAdminClient()
        .from("nodes")
        .select("*")
        .eq("id", s.node_id)
        .maybeSingle();
      if (node) {
        const stats = await agentFetch<{ playerNames?: string[] }>(
          node as Node,
          `/servers/${id}/stats`,
          { timeoutMs: 5000 },
        );
        online = stats.playerNames ?? [];
      }
    } catch {
      online = [];
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Players</h2>
        <p className="mt-1 text-sm text-ink-400">
          Whitelist, operators and bans. Changes apply instantly while the server runs.
        </p>
      </div>
      <PlayerManager
        serverId={id}
        initialPlayers={(players as ServerPlayer[]) ?? []}
        online={online}
        whitelistOn={s.whitelist_on}
      />
    </div>
  );
}
