"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  Cpu,
  MoreHorizontal,
  Play,
  Plus,
  Server as ServerIcon,
  Square,
  Users,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, StatusPill } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/client";
import { softwareInfo } from "@/lib/software";
import { cn, timeAgo } from "@/lib/utils";
import type { Server } from "@/lib/types";

export function ServerList({
  initialServers,
  domain,
}: {
  initialServers: Server[];
  domain: string;
}) {
  const [servers, setServers] = useState(initialServers);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live status: the panel never polls, the row updates when the node reports.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("dashboard-servers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "servers" },
        (payload) => {
          setServers((current) => {
            if (payload.eventType === "DELETE") {
              return current.filter((s) => s.id !== (payload.old as Server).id);
            }
            const next = payload.new as Server;
            return current.some((s) => s.id === next.id)
              ? current.map((s) => (s.id === next.id ? { ...s, ...next } : s))
              : [next, ...current];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function power(server: Server, action: "start" | "stop") {
    setBusy(server.id);
    setError(null);
    // Optimistic: the realtime event confirms or corrects this within a second.
    setServers((cur) =>
      cur.map((s) =>
        s.id === server.id
          ? { ...s, status: action === "start" ? "preparing" : "stopping" }
          : s,
      ),
    );
    try {
      await api(`/api/servers/${server.id}/power`, {
        method: "POST",
        json: { action },
      });
    } catch (err) {
      setError(errorMessage(err));
      setServers((cur) =>
        cur.map((s) => (s.id === server.id ? { ...s, status: server.status } : s)),
      );
    } finally {
      setBusy(null);
    }
  }

  if (!servers.length) {
    return (
      <EmptyState
        icon={<ServerIcon className="size-8" />}
        title="No servers yet"
        description="Create one and it will be online in about a minute. Pick any version, any software, Java or Bedrock."
        action={
          <Link href="/dashboard/new">
            <Button>
              <Plus className="size-4" />
              Create your first server
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
          {error}
        </div>
      )}

      {servers.map((server) => (
        <ServerRow
          key={server.id}
          server={server}
          domain={domain}
          busy={busy === server.id}
          onPower={power}
        />
      ))}
    </div>
  );
}

function ServerRow({
  server,
  domain,
  busy,
  onPower,
}: {
  server: Server;
  domain: string;
  busy: boolean;
  onPower: (server: Server, action: "start" | "stop") => void;
}) {
  const info = softwareInfo(server.software);
  const running = server.status !== "offline" && server.status !== "crashed";

  return (
    <Card className="animate-rise p-4 transition-colors hover:border-ink-600">
      <div className="flex flex-wrap items-center gap-4">
        <Link href={`/server/${server.id}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="truncate text-sm font-semibold text-ink-100">{server.name}</h3>
            <StatusPill status={server.status} detail={server.status_detail} />
            {server.queue_position && (
              <Badge tone="violet">#{server.queue_position} in queue</Badge>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
            <span className="flex items-center gap-1.5">
              <Cpu className="size-3.5" />
              {info.name} {server.version}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              {server.players_online}/{server.max_players}
            </span>
            <span>{(server.memory_mb / 1024).toFixed(server.memory_mb % 1024 ? 1 : 0)} GB RAM</span>
            <span>
              {server.status === "online" ? "online now" : `last online ${timeAgo(server.last_online_at)}`}
            </span>
          </div>
        </Link>

        <Address server={server} domain={domain} />

        <div className="flex items-center gap-2">
          {running ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => onPower(server, "stop")}
            >
              <Square className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button size="sm" loading={busy} onClick={() => onPower(server, "start")}>
              <Play className="size-3.5" />
              Start
            </Button>
          )}
          <Link href={`/server/${server.id}`}>
            <Button size="sm" variant="ghost" aria-label="Manage server">
              <MoreHorizontal className="size-4" />
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function Address({
  server,
  domain,
  className,
}: {
  server: Pick<Server, "subdomain" | "custom_domain" | "java_port" | "bedrock_port" | "edition">;
  domain: string;
  className?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const host = server.custom_domain ?? `${server.subdomain}.${domain}`;

  // A SRV record hides the port for Java; Bedrock clients always need one.
  const java = server.java_port && server.java_port !== 25565 ? `${host}:${server.java_port}` : host;
  const bedrock = server.bedrock_port ? `${host}:${server.bedrock_port}` : null;

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard blocked (insecure context) — the text is selectable anyway.
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {server.edition !== "bedrock" && (
        <button
          onClick={() => copy(java, "java")}
          className="group flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1 font-mono text-xs text-ink-200 transition-colors hover:border-ink-600"
          title="Copy Java address"
        >
          <Badge tone="grass" className="px-1.5 py-0">Java</Badge>
          <span className="truncate">{java}</span>
          {copied === "java" ? (
            <Check className="size-3.5 shrink-0 text-grass-400" />
          ) : (
            <Copy className="size-3.5 shrink-0 text-ink-500 group-hover:text-ink-300" />
          )}
        </button>
      )}

      {bedrock && (
        <button
          onClick={() => copy(bedrock, "bedrock")}
          className="group flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1 font-mono text-xs text-ink-200 transition-colors hover:border-ink-600"
          title="Copy Bedrock address"
        >
          <Badge tone="violet" className="px-1.5 py-0">Bedrock</Badge>
          <span className="truncate">{bedrock}</span>
          {copied === "bedrock" ? (
            <Check className="size-3.5 shrink-0 text-grass-400" />
          ) : (
            <Copy className="size-3.5 shrink-0 text-ink-500 group-hover:text-ink-300" />
          )}
        </button>
      )}
    </div>
  );
}
