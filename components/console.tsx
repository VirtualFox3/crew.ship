"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Download, Pause, Play, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { ServerStatus } from "@/lib/types";

const MAX_LINES = 2000;

/**
 * Live console.
 *
 * The socket goes straight from the browser to the node using a short-lived
 * token from the panel — serverless functions cannot hold a stream open, and
 * relaying every log line through one would add latency and cost for nothing.
 */
export function Console({
  serverId,
  status,
}: {
  serverId: string;
  status: ServerStatus;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const append = useCallback((incoming: string[]) => {
    setLines((current) => {
      const next = [...current, ...incoming];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  // Backfill from the node's log file, then attach the live stream.
  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        const recent = await api<{ lines: string[] }>(
          `/api/servers/${serverId}/logs?lines=300`,
        );
        if (!closed && recent.lines.length) setLines(recent.lines);
      } catch {
        // Node offline; the stream attempt below reports the real reason.
      }

      try {
        const ticket = await api<{ url: string }>(`/api/servers/${serverId}/console`, {
          method: "POST",
        });
        if (closed) return;

        socket = new WebSocket(ticket.url);
        socketRef.current = socket;

        socket.onopen = () => {
          setConnected(true);
          setError(null);
        };
        socket.onmessage = (event) => {
          const text = String(event.data);
          append(text.split(/\r?\n/).filter(Boolean));
        };
        socket.onclose = () => {
          setConnected(false);
          // Reconnect while the server is meant to be up.
          if (!closed) retry = setTimeout(connect, 4000);
        };
        socket.onerror = () => setConnected(false);
      } catch (err) {
        if (!closed) {
          setError(errorMessage(err));
          retry = setTimeout(connect, 8000);
        }
      }
    }

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      socketRef.current = null;
    };
  }, [serverId, append]);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, follow]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;

    setSending(true);
    setError(null);
    append([`> ${value}`]);
    setHistory((h) => [value, ...h].slice(0, 50));
    setHistoryIndex(-1);
    setCommand("");

    try {
      const result = await api<{ output?: string }>(`/api/servers/${serverId}/command`, {
        method: "POST",
        json: { command: value },
      });
      if (result.output) append(result.output.split(/\r?\n/).filter(Boolean));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      if (next >= 0) {
        setHistoryIndex(next);
        setCommand(history[next]);
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setCommand(next >= 0 ? history[next] : "");
    }
  }

  function download() {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `console-${serverId.slice(0, 8)}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Console
            <span
              className={cn(
                "size-1.5 rounded-full",
                connected ? "bg-grass-400" : "bg-ink-500",
              )}
              title={connected ? "Streaming live" : "Not connected"}
            />
          </span>
        }
        description={
          connected
            ? "Streaming live from the node"
            : status === "offline"
              ? "Start the server to stream output"
              : "Reconnecting…"
        }
        action={
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFollow((f) => !f)}
              title={follow ? "Pause auto-scroll" : "Resume auto-scroll"}
            >
              {follow ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={download} title="Download log">
              <Download className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLines([])}
              title="Clear view"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        }
      />

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (atBottom !== follow) setFollow(atBottom);
        }}
        className="h-[420px] overflow-y-auto bg-ink-950/80 px-4 py-3 font-mono text-[12px] leading-[1.55]"
      >
        {lines.length === 0 ? (
          <p className="py-16 text-center text-ink-600">
            {status === "offline"
              ? "Server is offline. Press Start to boot it."
              : "Waiting for output…"}
          </p>
        ) : (
          lines.map((line, i) => <LogLine key={i} text={line} />)
        )}
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-ink-700/70 p-3">
        <ChevronRight className="size-4 shrink-0 text-grass-500" />
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            status === "online" ? "say hello    (↑ for history)" : "Server must be online"
          }
          disabled={status !== "online" || sending}
          className="h-9 border-0 bg-transparent font-mono focus:ring-0"
          spellCheck={false}
          autoComplete="off"
        />
        <Button size="sm" type="submit" loading={sending} disabled={status !== "online"}>
          Send
        </Button>
      </form>

      {error && (
        <p className="border-t border-red-500/20 bg-red-500/8 px-4 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
    </Card>
  );
}

// Minecraft's log format is stable enough to colour by level without parsing.
function LogLine({ text }: { text: string }) {
  const tone = text.startsWith("> ")
    ? "text-grass-400"
    : /\b(ERROR|SEVERE|FATAL|Exception|Caused by)\b/.test(text)
      ? "text-red-400"
      : /\bWARN(ING)?\b/.test(text)
        ? "text-amber-400"
        : /\b(Done|joined the game|Starting minecraft server)\b/i.test(text)
          ? "text-grass-300"
          : /\bleft the game\b/i.test(text)
            ? "text-ink-400"
            : "text-ink-300";

  return <div className={cn("whitespace-pre-wrap break-words", tone)}>{text}</div>;
}
