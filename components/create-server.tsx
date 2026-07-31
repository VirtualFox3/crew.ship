"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Monitor,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner, Toggle } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { SOFTWARE } from "@/lib/software";
import { slugify } from "@/lib/utils";
import type { ServerEdition, ServerSoftware } from "@/lib/types";
import type { VersionOption } from "@/lib/versions";

type Step = 0 | 1 | 2 | 3;

const EDITIONS: {
  id: ServerEdition;
  title: string;
  body: string;
  icon: typeof Monitor;
  badge?: string;
}[] = [
  {
    id: "java",
    title: "Java Edition",
    body: "PC, Mac and Linux. Plugins, mods, datapacks — the full ecosystem.",
    icon: Monitor,
  },
  {
    id: "hybrid",
    title: "Java + Bedrock",
    body: "One world, everyone in it. Geyser and Floodgate are set up for you.",
    icon: Sparkles,
    badge: "Crossplay",
  },
  {
    id: "bedrock",
    title: "Bedrock Edition",
    body: "Phone, tablet, console, Switch and Windows 10. Native Bedrock server.",
    icon: Smartphone,
  },
];

export function CreateServer({ domain, suggested }: { domain: string; suggested: string }) {
  const router = useRouter();

  const [step, setStep] = useState<Step>(0);
  const [edition, setEdition] = useState<ServerEdition>("java");
  const [software, setSoftware] = useState<ServerSoftware>("paper");
  const [version, setVersion] = useState("");
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [showUnstable, setShowUnstable] = useState(false);

  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState(suggested);
  const [touchedSubdomain, setTouchedSubdomain] = useState(false);
  const [memory, setMemory] = useState(4096);
  const [slots, setSlots] = useState(100);
  const [motd, setMotd] = useState("A Pack.Host server");
  const [gamemode, setGamemode] = useState("survival");
  const [difficulty, setDifficulty] = useState("normal");
  const [seed, setSeed] = useState("");
  const [hardcore, setHardcore] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const crossplay = edition === "hybrid";

  const available = useMemo(() => {
    if (edition === "bedrock") return SOFTWARE.filter((s) => s.edition === "bedrock");
    if (crossplay) return SOFTWARE.filter((s) => s.supports.crossplay && !s.proxy);
    return SOFTWARE.filter((s) => s.edition === "java");
  }, [edition, crossplay]);

  // Keep the software choice legal whenever the edition changes.
  useEffect(() => {
    if (!available.some((s) => s.id === software)) {
      setSoftware((available.find((s) => s.recommended) ?? available[0]).id);
    }
  }, [available, software]);

  // Version list follows the software.
  useEffect(() => {
    let cancelled = false;
    setLoadingVersions(true);
    setVersions([]);

    api<{ versions: VersionOption[] }>(`/api/versions?software=${software}`)
      .then(({ versions }) => {
        if (cancelled) return;
        setVersions(versions);
        const firstStable = versions.find((v) => !v.unstable) ?? versions[0];
        if (firstStable) setVersion(firstStable.id);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load version list. Try again in a moment.");
      })
      .finally(() => !cancelled && setLoadingVersions(false));

    return () => {
      cancelled = true;
    };
  }, [software]);

  // Address mirrors the name until the user edits it directly.
  useEffect(() => {
    if (!touchedSubdomain && name) setSubdomain(slugify(name) || suggested);
  }, [name, touchedSubdomain, suggested]);

  const shown = showUnstable ? versions : versions.filter((v) => !v.unstable);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const { server } = await api<{ server: { id: string } }>("/api/servers", {
        method: "POST",
        json: {
          name: name.trim(),
          subdomain,
          edition: crossplay ? "java" : edition,
          software,
          version,
          memory_mb: memory,
          max_players: slots,
          crossplay,
          motd,
          gamemode,
          difficulty,
          seed: seed || null,
          hardcore,
        },
      });
      router.push(`/server/${server.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Steps step={step} />

      {error && <Alert tone="error">{error}</Alert>}

      {step === 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Who is playing?</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {EDITIONS.map(({ id, title, body, icon: Icon, badge }) => (
              <button
                key={id}
                onClick={() => setEdition(id)}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  edition === id
                    ? "border-grass-500 bg-grass-500/8"
                    : "border-ink-700 bg-ink-900/60 hover:border-ink-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <Icon
                    className={`size-5 ${edition === id ? "text-grass-400" : "text-ink-400"}`}
                  />
                  {badge && <Badge tone="violet">{badge}</Badge>}
                </div>
                <p className="mt-3 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-400">{body}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Pick your server software</h2>
          <p className="text-sm text-ink-400">
            You can switch this later without losing your world.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {available.map((s) => (
              <button
                key={s.id}
                onClick={() => setSoftware(s.id)}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  software === s.id
                    ? "border-grass-500 bg-grass-500/8"
                    : "border-ink-700 bg-ink-900/60 hover:border-ink-600"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <div className="flex gap-1.5">
                    {s.recommended && <Badge tone="grass">Recommended</Badge>}
                    {software === s.id && <Check className="size-4 text-grass-400" />}
                  </div>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{s.blurb}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {s.supports.plugins && <Badge>Plugins</Badge>}
                  {s.supports.mods && <Badge>Mods</Badge>}
                  {s.supports.datapacks && <Badge>Datapacks</Badge>}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Choose a version</h2>
              <p className="mt-1 text-sm text-ink-400">
                Pulled live from upstream — every release is here, all the way back.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-400">
              <input
                type="checkbox"
                checked={showUnstable}
                onChange={(e) => setShowUnstable(e.target.checked)}
                className="size-4 rounded border-ink-600 bg-ink-850 accent-grass-500"
              />
              Show snapshots &amp; pre-releases
            </label>
          </div>

          {loadingVersions ? (
            <Card className="grid place-items-center py-16 text-ink-500">
              <Spinner className="size-6" />
            </Card>
          ) : (
            <Card className="max-h-96 overflow-y-auto p-2">
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {shown.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVersion(v.id)}
                    className={`rounded-lg border px-2 py-2 text-center text-xs transition-colors ${
                      version === v.id
                        ? "border-grass-500 bg-grass-500/12 text-grass-300"
                        : "border-transparent bg-ink-850 text-ink-300 hover:bg-ink-800"
                    }`}
                    title={v.releasedAt ? new Date(v.releasedAt).toLocaleDateString() : undefined}
                  >
                    <span className="block truncate font-mono">{v.label}</span>
                    {v.unstable && (
                      <span className="mt-0.5 block text-[10px] text-amber-400/80">beta</span>
                    )}
                  </button>
                ))}
              </div>
              {!shown.length && (
                <p className="py-10 text-center text-sm text-ink-500">
                  No versions matched. Try enabling snapshots.
                </p>
              )}
            </Card>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Name it and go</h2>

          <Card className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Server name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Survival with friends"
                  maxLength={48}
                  autoFocus
                />
              </Field>

              <Field
                label="Address"
                hint={`Players will connect to ${subdomain || "your-server"}.${domain}`}
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    value={subdomain}
                    onChange={(e) => {
                      setTouchedSubdomain(true);
                      setSubdomain(slugify(e.target.value));
                    }}
                    placeholder="my-server"
                    maxLength={32}
                  />
                  <span className="shrink-0 font-mono text-xs text-ink-500">.{domain}</span>
                </div>
              </Field>

              <Field label="Memory" hint="More RAM helps with mods and big worlds.">
                <Select value={memory} onChange={(e) => setMemory(Number(e.target.value))}>
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
                  value={slots}
                  onChange={(e) => setSlots(Number(e.target.value))}
                />
              </Field>

              <Field label="Game mode">
                <Select value={gamemode} onChange={(e) => setGamemode(e.target.value)}>
                  <option value="survival">Survival</option>
                  <option value="creative">Creative</option>
                  <option value="adventure">Adventure</option>
                  <option value="spectator">Spectator</option>
                </Select>
              </Field>

              <Field label="Difficulty">
                <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value="peaceful">Peaceful</option>
                  <option value="easy">Easy</option>
                  <option value="normal">Normal</option>
                  <option value="hard">Hard</option>
                </Select>
              </Field>

              <Field label="MOTD" hint="Shown in the multiplayer server list.">
                <Input value={motd} onChange={(e) => setMotd(e.target.value)} maxLength={120} />
              </Field>

              <Field label="World seed" hint="Leave empty for a random world.">
                <Input
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="random"
                  maxLength={64}
                />
              </Field>
            </div>

            <Toggle
              checked={hardcore}
              onChange={setHardcore}
              label="Hardcore"
              description="Death is permanent and difficulty is locked to hard."
            />
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold">Summary</h3>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Row label="Edition" value={crossplay ? "Java + Bedrock crossplay" : edition === "bedrock" ? "Bedrock" : "Java"} />
              <Row label="Software" value={SOFTWARE.find((s) => s.id === software)?.name ?? software} />
              <Row label="Version" value={version || "—"} />
              <Row label="Memory" value={`${memory / 1024} GB`} />
              <Row label="Slots" value={String(slots)} />
              <Row label="Price" value="Free" />
            </dl>
          </Card>
        </section>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
          disabled={step === 0 || submitting}
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>

        {step < 3 ? (
          <Button
            onClick={() => setStep((s) => (s + 1) as Step)}
            disabled={step === 2 && !version}
          >
            Continue
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={submit} loading={submitting} disabled={!name.trim() || !subdomain}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Create server
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ink-800 pb-2">
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-medium text-ink-100">{value}</dd>
    </div>
  );
}

const STEP_LABELS = ["Edition", "Software", "Version", "Details"];

function Steps({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEP_LABELS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <div
            className={`flex items-center gap-2 text-xs ${
              i <= step ? "text-grass-300" : "text-ink-500"
            }`}
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${
                i < step
                  ? "border-grass-500 bg-grass-500 text-ink-950"
                  : i === step
                    ? "border-grass-500 text-grass-300"
                    : "border-ink-600 text-ink-500"
              }`}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <span
              className={`h-px flex-1 ${i < step ? "bg-grass-500/50" : "bg-ink-700"}`}
            />
          )}
        </li>
      ))}
    </ol>
  );
}
