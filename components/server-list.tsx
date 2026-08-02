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
import { ADDRESS_HINT, resolveAddress, type ResolvedAddress } from "@/lib/address";
import type { Node, Server } from "@/lib/types";

/** The parts of a node the browser needs to render an address. */
export type NodeAddressInfo = Pick<Node, "public_host" | "tunnel_host" | "tunnel_ports">;

export function ServerList({
  initialServers,
  domain,
  nodes,
}: {
  initialServers: Server[];
  domain: string;
  /** Keyed by node id. Servers not yet placed simply have no entry. */
  nodes: Record<string, NodeAddressInfo>;
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
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
          {error}
        </div>
      )}

      {servers.map((server) => (
        <ServerRow
          key={server.id}
          server={server}
          domain={domain}
          node={server.node_id ? (nodes[server.node_id] ?? null) : null}
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
  node,
  busy,
  onPower,
}: {
  server: Server;
  domain: string;
  node: NodeAddressInfo | null;
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

        <Address address={resolveAddress(server, node, domain)} />

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
  address,
  className,
}: {
  address: ResolvedAddress;
  className?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard blocked (insecure context) — the text is selectable anyway.
    }
  }

  if (!address.java && !address.bedrock) {
    return (
      <p className={cn("text-xs text-ink-500", className)}>
        {ADDRESS_HINT.unassigned}
      </p>
    );
  }

  const rows: { key: string; label: string; tone: "grass" | "violet"; value: string }[] = [];
  if (address.java) rows.push({ key: "java", label: "Java", tone: "grass", value: address.java });
  if (address.bedrock) {
    rows.push({ key: "bedrock", label: "Bedrock", tone: "violet", value: address.bedrock });
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {rows.map((row) => (
        <button
          key={row.key}
          onClick={() => copy(row.value, row.key)}
  className="group flex items-center gap-2 border border-ink-700 bg-ink-850 px-2.5 py-1 font-mono text-xs text-ink-200 transition-colors hover:border-ink-600"
          title={ADDRESS_HINT[address.via] ?? `Copy ${row.label} address`}
        >
          <Badge tone={row.tone} className="px-1.5 py-0">
            {row.label}
          </Badge>
          <span className="truncate">{row.value}</span>
          {copied === row.key ? (
            <Check className="size-3.5 shrink-0 text-grass-400" />
          ) : (
            <Copy className="size-3.5 shrink-0 text-ink-500 group-hover:text-ink-300" />
          )}
        </button>
      ))}
    </div>
  );
}
