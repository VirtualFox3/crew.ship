"use client";

import { useState } from "react";
import { Ban, Crown, Plus, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Select,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import type { PlayerList, ServerPlayer } from "@/lib/types";

const LISTS: {
  id: PlayerList;
  label: string;
  icon: typeof UserCheck;
  blurb: string;
}[] = [
  {
    id: "whitelist",
    label: "Whitelist",
    icon: UserCheck,
    blurb: "Only these players can join when the whitelist is on.",
  },
  {
    id: "op",
    label: "Operators",
    icon: Crown,
    blurb: "Full command access. Give this out carefully.",
  },
  {
    id: "ban",
    label: "Banned",
    icon: Ban,
    blurb: "Blocked from joining, with an optional reason shown on kick.",
  },
];

export function PlayerManager({
  serverId,
  initialPlayers,
  online,
  whitelistOn,
}: {
  serverId: string;
  initialPlayers: ServerPlayer[];
  online: string[];
  whitelistOn: boolean;
}) {
  const [players, setPlayers] = useState(initialPlayers);
  const [list, setList] = useState<PlayerList>("whitelist");
  const [username, setUsername] = useState("");
  const [level, setLevel] = useState(4);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = LISTS.find((l) => l.id === list)!;
  const rows = players.filter((p) => p.list === list);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim()) return;

    setBusy("add");
    setError(null);
    try {
      const { player } = await api<{ player: ServerPlayer }>(
        `/api/servers/${serverId}/players`,
        {
          method: "POST",
          json: {
            list,
            username: username.trim(),
            ...(list === "op" ? { level } : {}),
            ...(list === "ban" && reason ? { reason } : {}),
          },
        },
      );
      setPlayers((cur) => [player, ...cur.filter((p) => p.id !== player.id)]);
      setUsername("");
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(player: ServerPlayer) {
    setBusy(player.id);
    try {
      await api(`/api/servers/${serverId}/players?player=${player.id}`, {
        method: "DELETE",
      });
      setPlayers((cur) => cur.filter((p) => p.id !== player.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {online.length > 0 && (
        <Card>
          <CardHeader
            title={`${online.length} online now`}
            description="Connected to the server this second."
          />
          <div className="flex flex-wrap gap-2 p-4">
            {online.map((name) => (
              <span
                key={name}
  className="flex items-center gap-2 border border-ink-700 bg-ink-850 py-1 pl-1 pr-3 text-sm"
              >
                {/* Avatar service is public and needs no key. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://mc-heads.net/avatar/${encodeURIComponent(name)}/24`}
                  alt=""
  className="size-6 rounded"
                />
                {name}
              </span>
            ))}
          </div>
        </Card>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        {LISTS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setList(id)}
  className={`flex items-center gap-2  border px-3.5 py-2 text-sm transition-colors ${
              list === id
                ? "border-grass-500 bg-grass-500/10 text-grass-300"
                : "border-ink-700 bg-ink-900 text-ink-400 hover:border-ink-600"
            }`}
          >
            <Icon className="size-4" />
            {label}
            <Badge>{players.filter((p) => p.list === id).length}</Badge>
          </button>
        ))}
      </div>

      {list === "whitelist" && !whitelistOn && (
        <Alert tone="warn" title="Whitelist is off">
          Names below are saved but not enforced. Turn on the whitelist under Options.
        </Alert>
      )}

      <Card>
        <CardHeader title={active.label} description={active.blurb} />

        <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-b border-ink-800 p-4">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Minecraft username"
  className="min-w-48 flex-1"
            maxLength={16}
          />
          {list === "op" && (
            <Select
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
  className="w-40"
            >
              <option value={1}>Level 1 — bypass spawn</option>
              <option value={2}>Level 2 — cheats</option>
              <option value={3}>Level 3 — moderation</option>
              <option value={4}>Level 4 — full</option>
            </Select>
          )}
          {list === "ban" && (
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
  className="min-w-40 flex-1"
              maxLength={200}
            />
          )}
          <Button type="submit" loading={busy === "add"} disabled={!username.trim()}>
            <Plus className="size-4" />
            Add
          </Button>
        </form>

        {rows.length ? (
          <ul className="divide-y divide-ink-800">
            {rows.map((player) => (
              <li key={player.id} className="flex items-center gap-3 px-4 py-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://mc-heads.net/avatar/${encodeURIComponent(player.username)}/32`}
                  alt=""
  className="size-8 rounded"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{player.username}</p>
                  {player.list === "op" && (
                    <p className="text-xs text-ink-500">Level {player.level ?? 4}</p>
                  )}
                  {player.list === "ban" && player.reason && (
                    <p className="truncate text-xs text-ink-500">{player.reason}</p>
                  )}
                </div>
                {online.includes(player.username) && <Badge tone="grass">Online</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === player.id}
                  onClick={() => remove(player)}
  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  title="Remove"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<ShieldCheck className="size-6" />}
              title={`Nobody on the ${active.label.toLowerCase()}`}
              description="Add a username above. Changes apply instantly on a running server."
            />
          </div>
        )}
      </Card>
    </div>
  );
}
