"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, HistoryIcon, Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatBytes, timeAgo } from "@/lib/utils";
import type { Backup } from "@/lib/types";

export function BackupManager({
  serverId,
  initialBackups,
  offline,
}: {
  serverId: string;
  initialBackups: Backup[];
  offline: boolean;
}) {
  const router = useRouter();
  const [backups, setBackups] = useState(initialBackups);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create() {
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const { backup } = await api<{ backup: Backup }>(
        `/api/servers/${serverId}/backups`,
        { method: "POST", json: name.trim() ? { name: name.trim() } : {} },
      );
      setBackups((cur) => [backup, ...cur]);
      setName("");
      setNotice("Backup created.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function restore(backup: Backup) {
    if (
      !confirm(
        `Restore "${backup.name}"? The current world and configuration are replaced.`,
      )
    ) {
      return;
    }
    setBusy(backup.id);
    setError(null);
    try {
      await api(`/api/servers/${serverId}/backups`, {
        method: "PUT",
        json: { backup: backup.id },
      });
      setNotice(`Restored "${backup.name}". Start the server to play on it.`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(backup: Backup) {
    setBusy(backup.id);
    try {
      await api(`/api/servers/${serverId}/backups?backup=${backup.id}`, {
        method: "DELETE",
      });
      setBackups((cur) => cur.filter((b) => b.id !== backup.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card>
        <CardHeader
          title="Backups"
          description="Full snapshots of the world, plugins and configuration. Take as many as your storage allows."
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 p-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Before the nether trip (optional name)"
            className="min-w-48 flex-1"
            maxLength={64}
          />
          <Button loading={busy === "create"} onClick={create}>
            <Plus className="size-4" />
            Create backup
          </Button>
        </div>

        {backups.length ? (
          <ul className="divide-y divide-ink-800">
            {backups.map((backup) => (
              <li key={backup.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Archive className="size-4 shrink-0 text-grass-400" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {backup.name}
                    {backup.automatic && <Badge>Automatic</Badge>}
                  </p>
                  <p className="text-xs text-ink-500">
                    {formatBytes(backup.size_bytes)} · {timeAgo(backup.created_at)}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === backup.id}
                  disabled={!offline}
                  onClick={() => restore(backup)}
                  title={offline ? "Restore this snapshot" : "Stop the server to restore"}
                >
                  <HistoryIcon className="size-3.5" />
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === backup.id}
                  onClick={() => remove(backup)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  title="Delete backup"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<Archive className="size-6" />}
              title="No backups yet"
              description="Take one before installing a big modpack or changing versions."
            />
          </div>
        )}
      </Card>

      {!offline && (
        <Alert tone="info">
          Restoring requires the server to be offline so the world is not being written to.
        </Alert>
      )}
    </div>
  );
}
