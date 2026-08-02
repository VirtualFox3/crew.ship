"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderPlus,
  Home,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Spinner,
  Textarea,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatBytes, timeAgo } from "@/lib/utils";
import type { FileEntry } from "@/lib/types";

const EDITABLE = /\.(txt|properties|ya?ml|json|json5|toml|cfg|conf|ini|log|md|sh|mcfunction|snbt|csv)$/i;

export function FileManager({ serverId }: { serverId: string }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        const { entries } = await api<{ entries: FileEntry[] }>(
          `/api/servers/${serverId}/files?path=${encodeURIComponent(target)}`,
        );
        // Directories first, then alphabetical — matches every file browser.
        setEntries(
          [...entries].sort((a, b) =>
            a.directory === b.directory
              ? a.name.localeCompare(b.name)
              : a.directory
                ? -1
                : 1,
          ),
        );
        setPath(target);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [serverId],
  );

  useEffect(() => {
    load("");
  }, [load]);

  async function open(entry: FileEntry) {
    if (entry.directory) return load(entry.path);

    if (!EDITABLE.test(entry.name)) {
      setError("That file type cannot be edited here. Download a backup to work on it.");
      return;
    }

    setError(null);
    try {
      const { content } = await api<{ content: string }>(
        `/api/servers/${serverId}/files?read=1&path=${encodeURIComponent(entry.path)}`,
      );
      setEditing({ path: entry.path, content });
      setDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/api/servers/${serverId}/files`, {
        method: "PUT",
        json: { path: editing.path, content: editing.content },
      });
      setDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: FileEntry) {
    if (!confirm(`Delete ${entry.name}? This cannot be undone.`)) return;
    try {
      await api(`/api/servers/${serverId}/files?path=${encodeURIComponent(entry.path)}`, {
        method: "DELETE",
      });
      setEntries((cur) => cur.filter((e) => e.path !== entry.path));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function create() {
    if (!newName.trim()) return;
    try {
      await api(`/api/servers/${serverId}/files`, {
        method: "POST",
        json: {
          path: path ? `${path}/${newName.trim()}` : newName.trim(),
          directory: creating === "folder",
        },
      });
      setNewName("");
      setCreating(null);
      load(path);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const crumbs = path ? path.split("/") : [];

  if (editing) {
    return (
      <Card className="overflow-hidden">
        <CardHeader
          title={<span className="font-mono text-xs">{editing.path}</span>}
          description={dirty ? "Unsaved changes" : "Saved"}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                <X className="size-3.5" />
                Close
              </Button>
              <Button size="sm" loading={saving} disabled={!dirty} onClick={save}>
                <Save className="size-3.5" />
                Save
              </Button>
            </div>
          }
        />
        {error && (
          <p className="border-b border-red-500/20 bg-red-500/8 px-5 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <Textarea
          value={editing.content}
          onChange={(e) => {
            setEditing({ ...editing, content: e.target.value });
            setDirty(true);
          }}
          spellCheck={false}
  className="h-[480px] resize-none rounded-none border-0 bg-ink-950/80 font-mono text-xs leading-relaxed focus:ring-0"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardHeader
          title={
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <button
                onClick={() => load("")}
  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-300 hover:bg-ink-800"
              >
                <Home className="size-3.5" />
                server
              </button>
              {crumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="size-3 text-ink-600" />
                  <button
                    onClick={() => load(crumbs.slice(0, i + 1).join("/"))}
  className="rounded px-1.5 py-0.5 font-mono text-ink-300 hover:bg-ink-800"
                  >
                    {crumb}
                  </button>
                </span>
              ))}
            </div>
          }
          action={
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setCreating("folder")}>
                <FolderPlus className="size-3.5" />
                Folder
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating("file")}>
                <FilePlus className="size-3.5" />
                File
              </Button>
            </div>
          }
        />

        {creating && (
          <div className="flex items-center gap-2 border-b border-ink-800 p-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder={creating === "folder" ? "new-folder" : "config.yml"}
              autoFocus
            />
            <Button size="sm" onClick={create} disabled={!newName.trim()}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(null)}>
              Cancel
            </Button>
          </div>
        )}

        {loading ? (
          <div className="grid place-items-center py-16 text-ink-500">
            <Spinner className="size-6" />
          </div>
        ) : entries.length ? (
          <ul className="divide-y divide-ink-800">
            {path && (
              <li>
                <button
                  onClick={() => load(crumbs.slice(0, -1).join("/"))}
  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-400 hover:bg-ink-850"
                >
                  <Folder className="size-4" />
                  ..
                </button>
              </li>
            )}
            {entries.map((entry) => (
              <li key={entry.path} className="group flex items-center gap-3 px-4 hover:bg-ink-850">
                <button
                  onClick={() => open(entry)}
  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                >
                  {entry.directory ? (
                    <Folder className="size-4 shrink-0 text-grass-400" />
                  ) : (
                    <FileIcon className="size-4 shrink-0 text-ink-500" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">
                    {entry.name}
                  </span>
                  <span className="hidden shrink-0 text-xs text-ink-500 sm:inline">
                    {entry.directory ? "—" : formatBytes(entry.size)}
                  </span>
                  <span className="hidden w-24 shrink-0 text-right text-xs text-ink-500 md:inline">
                    {timeAgo(entry.modified)}
                  </span>
                </button>
                <button
                  onClick={() => remove(entry)}
  className="rounded p-1.5 text-ink-600 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<Folder className="size-6" />}
              title="This folder is empty"
              description="Start the server once and Minecraft will generate its files here."
            />
          </div>
        )}
      </Card>
    </div>
  );
}
