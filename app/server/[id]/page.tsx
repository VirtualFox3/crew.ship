import { notFound } from "next/navigation";
import { Activity, Clock, Cpu, HardDrive, Puzzle, Users } from "lucide-react";
import { Card, CardHeader, Stat } from "@/components/ui";
import { Console } from "@/components/console";
import { createClient } from "@/lib/supabase/server";
import { softwareInfo } from "@/lib/software";
import { timeAgo } from "@/lib/utils";
import type { Server } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ServerOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: server }, { count: addonCount }, { data: events }] = await Promise.all([
    supabase.from("servers").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("server_addons")
      .select("id", { count: "exact", head: true })
      .eq("server_id", id),
    supabase
      .from("server_events")
      .select("action, detail, created_at")
      .eq("server_id", id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  if (!server) notFound();
  const s = server as Server;
  const info = softwareInfo(s.software);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Players"
          value={
            <span className="flex items-center gap-2">
              <Users className="size-4 text-grass-400" />
              {s.players_online} / {s.max_players}
            </span>
          }
          sub={s.status === "online" ? "connected now" : "server offline"}
        />
        <Stat
          label="Memory"
          value={
            <span className="flex items-center gap-2">
              <Cpu className="size-4 text-grass-400" />
              {(s.memory_mb / 1024).toFixed(s.memory_mb % 1024 ? 1 : 0)} GB
            </span>
          }
          sub={`${s.cpu_cores} vCPU allocated`}
        />
        <Stat
          label="Storage"
          value={
            <span className="flex items-center gap-2">
              <HardDrive className="size-4 text-grass-400" />
              {(s.storage_mb / 1024).toFixed(0)} GB
            </span>
          }
          sub="world, plugins and backups"
        />
        <Stat
          label={info.supports.mods ? "Mods installed" : "Plugins installed"}
          value={
            <span className="flex items-center gap-2">
              <Puzzle className="size-4 text-grass-400" />
              {addonCount ?? 0}
            </span>
          }
          sub="no limit"
        />
        <Stat
          label="Software"
          value={info.name}
          sub={`Minecraft ${s.version}`}
        />
        <Stat
          label="Last online"
          value={
            <span className="flex items-center gap-2">
              <Clock className="size-4 text-grass-400" />
              {s.status === "online" ? "now" : timeAgo(s.last_online_at)}
            </span>
          }
          sub={s.auto_stop_minutes ? `sleeps after ${s.auto_stop_minutes} min idle` : "never sleeps"}
        />
      </div>

      <Console serverId={id} status={s.status} />

      <Card>
        <CardHeader
          title="Recent activity"
          description="Every action taken on this server, by you or by the node."
        />
        {events?.length ? (
          <ul className="divide-y divide-ink-800">
            {events.map((event, i) => (
              <li key={i} className="flex items-center justify-between gap-4 px-5 py-2.5">
                <span className="flex min-w-0 items-center gap-2.5 text-sm">
                  <Activity className="size-3.5 shrink-0 text-ink-500" />
                  <span className="text-ink-200">{describe(event.action)}</span>
                  {event.detail && (
                    <span className="truncate font-mono text-xs text-ink-500">
                      {event.detail}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-ink-500">
                  {timeAgo(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            Nothing has happened yet.
          </p>
        )}
      </Card>
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  "power.start": "Server started",
  "power.stop": "Server stopped",
  "power.restart": "Server restarted",
  "power.kill": "Server killed",
  "console.command": "Command run",
  "addon.install": "Add-on installed",
  "addon.remove": "Add-on removed",
  "settings.update": "Settings changed",
  "backup.create": "Backup created",
  "backup.restore": "Backup restored",
  "world.reset": "World reset",
  "world.activate": "World switched",
  "file.write": "File saved",
  "file.delete": "File deleted",
  "access.grant": "Access granted",
  "agent.online": "Node reported online",
  "agent.offline": "Node reported offline",
  "agent.crashed": "Server crashed",
};

function describe(action: string): string {
  return ACTIONS[action] ?? action.replace(/[._]/g, " ");
}
