"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, RefreshCw, Sparkles } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Spinner,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatBytes } from "@/lib/utils";

interface World {
  name: string;
  sizeBytes: number;
  active: boolean;
}

export function WorldManager({
  serverId,
  offline,
  currentSeed,
}: {
  serverId: string;
  offline: boolean;
  currentSeed: string | null;
}) {
  const router = useRouter();
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(true);
  const [seed, setSeed] = useState(currentSeed ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ worlds: World[] }>(`/api/servers/${serverId}/worlds`)
      .then(({ worlds }) => setWorlds(worlds))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [serverId]);

  async function reset() {
    if (
      !confirm(
        "Delete the current world and generate a fresh one? Everything built there is lost.",
      )
    ) {
      return;
    }
    setBusy("reset");
    setError(null);
    setNotice(null);
    try {
      await api(`/api/servers/${serverId}/worlds`, {
        method: "POST",
        json: { action: "reset", seed: seed || null },
      });
      setNotice("World reset. A new one generates on the next start.");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function activate(world: World) {
    setBusy(world.name);
    setError(null);
    try {
      await api(`/api/servers/${serverId}/worlds`, {
        method: "POST",
        json: { action: "activate", world: world.name },
      });
      setWorlds((cur) => cur.map((w) => ({ ...w, active: w.name === world.name })));
      setNotice(`"${world.name}" is now the active world.`);
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
      {!offline && (
        <Alert tone="warn">Stop the server before switching or resetting worlds.</Alert>
      )}

      <Card>
        <CardHeader
          title="Worlds on this server"
          description="Every world folder the server has generated or you have uploaded."
        />
        {loading ? (
          <div className="grid place-items-center py-14 text-ink-500">
            <Spinner className="size-6" />
          </div>
        ) : worlds.length ? (
          <ul className="divide-y divide-ink-800">
            {worlds.map((world) => (
              <li key={world.name} className="flex items-center gap-3 px-4 py-3">
                <Globe className="size-4 shrink-0 text-grass-400" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {world.name}
                    {world.active && <Badge tone="grass">Active</Badge>}
                  </p>
                  <p className="text-xs text-ink-500">{formatBytes(world.sizeBytes)}</p>
                </div>
                {!world.active && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!offline}
                    loading={busy === world.name}
                    onClick={() => activate(world)}
                  >
                    Make active
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<Globe className="size-6" />}
              title="No world yet"
              description="Start the server once and Minecraft generates one."
            />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Generate a new world"
          description="Wipes the current world folder and regenerates from the seed below."
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <Field
            label="Seed"
            hint="Leave empty for a random world."
            className="min-w-48 flex-1"
          >
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              maxLength={64}
            />
          </Field>
          <Button
            variant="danger"
            loading={busy === "reset"}
            disabled={!offline}
            onClick={reset}
          >
            <RefreshCw className="size-4" />
            Reset world
          </Button>
        </div>
        <p className="flex items-center gap-2 border-t border-ink-800 px-5 py-3 text-xs text-ink-500">
          <Sparkles className="size-3.5 shrink-0" />
          Take a backup first — a reset cannot be undone from here.
        </p>
      </Card>
    </div>
  );
}
