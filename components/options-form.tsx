"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, TriangleAlert } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Toggle,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import type { Server } from "@/lib/types";

type Draft = Partial<Server>;

export function OptionsForm({
  server,
  canCrossplay,
  isOwner,
}: {
  server: Server;
  canCrossplay: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const value = <K extends keyof Server>(key: K): Server[K] =>
    (draft[key] ?? server[key]) as Server[K];

  const set = <K extends keyof Server>(key: K, next: Server[K]) =>
    setDraft((d) => ({ ...d, [key]: next }));

  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const result = await api<{ restartRequired: boolean }>(`/api/servers/${server.id}`, {
        method: "PATCH",
        json: draft,
      });
      setDraft({});
      setSaved(
        result.restartRequired && server.status === "online"
          ? "Saved. Restart the server to apply everything."
          : "Saved.",
      );
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/servers/${server.id}`, { method: "DELETE" });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}

      <Card>
        <CardHeader title="General" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Server name">
            <Input
              value={value("name")}
              onChange={(e) => set("name", e.target.value)}
              maxLength={48}
            />
          </Field>
          <Field label="MOTD" hint="Shown in the multiplayer list.">
            <Input
              value={value("motd")}
              onChange={(e) => set("motd", e.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label="Memory" hint="Applied on next start.">
            <Select
              value={value("memory_mb")}
              onChange={(e) => set("memory_mb", Number(e.target.value))}
            >
              {[1024, 2048, 3072, 4096, 6144, 8192, 12288, 16384].map((mb) => (
                <option key={mb} value={mb}>
                  {mb / 1024} GB
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Player slots">
            <Input
              type="number"
              min={1}
              max={1000}
              value={value("max_players")}
              onChange={(e) => set("max_players", Number(e.target.value))}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Gameplay" description="Written straight into server.properties." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Game mode">
            <Select value={value("gamemode")} onChange={(e) => set("gamemode", e.target.value)}>
              <option value="survival">Survival</option>
              <option value="creative">Creative</option>
              <option value="adventure">Adventure</option>
              <option value="spectator">Spectator</option>
            </Select>
          </Field>
          <Field label="Difficulty">
            <Select
              value={value("difficulty")}
              onChange={(e) => set("difficulty", e.target.value)}
            >
              <option value="peaceful">Peaceful</option>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
          <Field label="View distance" hint="Lower helps a crowded server.">
            <Input
              type="number"
              min={3}
              max={32}
              value={value("view_distance")}
              onChange={(e) => set("view_distance", Number(e.target.value))}
            />
          </Field>
          <Field label="Simulation distance">
            <Input
              type="number"
              min={3}
              max={32}
              value={value("simulation_distance")}
              onChange={(e) => set("simulation_distance", Number(e.target.value))}
            />
          </Field>
          <Field label="Spawn protection" hint="Blocks around spawn only ops can build in.">
            <Input
              type="number"
              min={0}
              max={256}
              value={value("spawn_protection")}
              onChange={(e) => set("spawn_protection", Number(e.target.value))}
            />
          </Field>
          <Field label="Level type">
            <Select
              value={value("level_type")}
              onChange={(e) => set("level_type", e.target.value)}
            >
              <option value="minecraft:normal">Normal</option>
              <option value="minecraft:flat">Superflat</option>
              <option value="minecraft:large_biomes">Large biomes</option>
              <option value="minecraft:amplified">Amplified</option>
              <option value="minecraft:single_biome_surface">Single biome</option>
            </Select>
          </Field>
        </div>

        <div className="grid gap-2 border-t border-ink-800 p-5 sm:grid-cols-2">
          <Toggle
            checked={value("pvp")}
            onChange={(v) => set("pvp", v)}
            label="PvP"
            description="Players can damage each other."
          />
          <Toggle
            checked={value("whitelist_on")}
            onChange={(v) => set("whitelist_on", v)}
            label="Whitelist"
            description="Only listed players may join."
          />
          <Toggle
            checked={value("online_mode")}
            onChange={(v) => set("online_mode", v)}
            label="Online mode"
            description="Verify accounts with Mojang. Turning this off allows cracked clients."
          />
          <Toggle
            checked={value("command_blocks")}
            onChange={(v) => set("command_blocks", v)}
            label="Command blocks"
          />
          <Toggle
            checked={value("flight")}
            onChange={(v) => set("flight", v)}
            label="Allow flight"
            description="Needed for many mods and elytra plugins."
          />
          <Toggle
            checked={value("hardcore")}
            onChange={(v) => set("hardcore", v)}
            label="Hardcore"
            description="Permanent death, difficulty locked to hard."
          />
          <Toggle
            checked={value("crossplay")}
            onChange={(v) => set("crossplay", v)}
            disabled={!canCrossplay}
            label="Bedrock crossplay"
            description={
              canCrossplay
                ? "Installs Geyser and Floodgate and opens a Bedrock port."
                : "This software cannot bridge Bedrock players."
            }
          />
          <Toggle
            checked={value("auto_start")}
            onChange={(v) => set("auto_start", v)}
            label="Auto-start"
            description="Boot automatically when a player pings the address."
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Performance and sleep"
          description="Idle servers sleep so the fleet stays free for everyone."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Sleep after" hint="0 keeps the server awake forever.">
            <Select
              value={value("auto_stop_minutes")}
              onChange={(e) => set("auto_stop_minutes", Number(e.target.value))}
            >
              <option value={0}>Never sleep</option>
              {[5, 10, 15, 30, 60, 120, 180].map((m) => (
                <option key={m} value={m}>
                  {m} minutes idle
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Custom JVM flags"
            hint="Advanced. Leave empty to use Aikar's tuned defaults."
          >
            <Input
              value={value("java_flags") ?? ""}
              onChange={(e) => set("java_flags", e.target.value || null)}
              placeholder="-XX:+UseG1GC …"
            />
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} loading={saving} disabled={!dirty}>
          <Save className="size-4" />
          Save changes
        </Button>
      </div>

      {isOwner && (
        <Card className="border-red-500/25">
          <CardHeader
            title={
              <span className="flex items-center gap-2 text-red-300">
                <TriangleAlert className="size-4" />
                Delete this server
              </span>
            }
            description="The world, plugins, backups and address are removed for good. Download a backup first if you want to keep anything."
          />
          <div className="flex flex-wrap items-end gap-3 p-5">
            <Field
              label={`Type "${server.name}" to confirm`}
  className="min-w-56 flex-1"
            >
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={server.name}
              />
            </Field>
            <Button
              variant="danger"
              loading={deleting}
              disabled={confirmName !== server.name}
              onClick={destroy}
            >
              <Trash2 className="size-4" />
              Delete permanently
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
