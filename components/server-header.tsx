"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCw, Square, Zap } from "lucide-react";
import { Alert, Button, StatusPill } from "@/components/ui";
import { Address } from "@/components/server-list";
import { api, errorMessage } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/client";
import { softwareInfo } from "@/lib/software";
import { ADDRESS_HINT, type ResolvedAddress } from "@/lib/address";
import type { Server } from "@/lib/types";

/** Status + power controls, kept live over Supabase realtime. */
export function ServerHeader({
  initialServer,
  address,
  nodeName,
}: {
  initialServer: Server;
  address: ResolvedAddress;
  nodeName: string | null;
}) {
  const router = useRouter();
  const [server, setServer] = useState(initialServer);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`server-${initialServer.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "servers",
          filter: `id=eq.${initialServer.id}`,
        },
        (payload) => setServer((s) => ({ ...s, ...(payload.new as Server) })),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [initialServer.id]);

  async function power(action: "start" | "stop" | "restart" | "kill") {
    setBusy(action);
    setError(null);
    try {
      const result = await api<{ status: Server["status"]; queuePosition?: number }>(
        `/api/servers/${server.id}/power`,
        { method: "POST", json: { action } },
      );
      setServer((s) => ({
        ...s,
        status: result.status,
        queue_position: result.queuePosition ?? null,
      }));
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const info = softwareInfo(server.software);
  const offline = server.status === "offline" || server.status === "crashed";
  const settling = ["preparing", "starting", "stopping"].includes(server.status);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{server.name}</h1>
            <StatusPill status={server.status} detail={server.status_detail} />
          </div>
          <p className="mt-1.5 text-sm text-ink-400">
            {info.name} {server.version} · {(server.memory_mb / 1024).toFixed(
              server.memory_mb % 1024 ? 1 : 0,
            )} GB · {server.players_online}/{server.max_players} players
            {nodeName && ` · ${nodeName}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Address address={address} />

          {offline ? (
            <Button loading={busy === "start"} onClick={() => power("start")}>
              <Play className="size-4" />
              Start
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                loading={busy === "restart"}
                disabled={settling}
                onClick={() => power("restart")}
              >
                <RotateCw className="size-4" />
                Restart
              </Button>
              <Button
                variant="secondary"
                loading={busy === "stop"}
                disabled={settling}
                onClick={() => power("stop")}
              >
                <Square className="size-4" />
                Stop
              </Button>
            </>
          )}

          {settling && (
            <Button
              variant="ghost"
              size="sm"
              loading={busy === "kill"}
              onClick={() => power("kill")}
              title="Force stop without saving"
            >
              <Zap className="size-4" />
              Kill
            </Button>
          )}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {ADDRESS_HINT[address.via] && server.status !== "offline" && (
        <p className="text-xs text-ink-500">{ADDRESS_HINT[address.via]}</p>
      )}

      {server.status === "queued" && (
        <Alert tone="info" title={`Queue position ${server.queue_position ?? "—"}`}>
          {server.status_detail === "Waiting for your host computer to come online"
            ? "Your registered host computer is offline. Start its Howl.Host agent and this server will continue automatically."
            : "Your computer has no free capacity right now. The server starts automatically when capacity becomes available."}
        </Alert>
      )}

      {server.status === "crashed" && (
        <Alert tone="error" title="The server stopped unexpectedly">
          {server.status_detail ?? "Check the console below for the last lines before the crash."}
        </Alert>
      )}
    </div>
  );
}
