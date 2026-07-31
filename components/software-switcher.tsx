"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { SOFTWARE } from "@/lib/software";
import type { ServerSoftware } from "@/lib/types";
import type { VersionOption } from "@/lib/versions";

/**
 * Change software or Minecraft version in place. The world directory is left
 * untouched — only the server jar is swapped on next start.
 */
export function SoftwareSwitcher({
  serverId,
  edition,
  currentSoftware,
  currentVersion,
  online,
}: {
  serverId: string;
  edition: "java" | "bedrock" | "hybrid";
  currentSoftware: ServerSoftware;
  currentVersion: string;
  online: boolean;
}) {
  const router = useRouter();
  const [software, setSoftware] = useState<ServerSoftware>(currentSoftware);
  const [version, setVersion] = useState(currentVersion);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [showUnstable, setShowUnstable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const available = SOFTWARE.filter((s) =>
    edition === "bedrock" ? s.edition === "bedrock" : s.edition === "java",
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api<{ versions: VersionOption[] }>(`/api/versions?software=${software}`)
      .then(({ versions }) => {
        if (cancelled) return;
        setVersions(versions);
        // Keep the current version selected when it still exists upstream.
        if (!versions.some((v) => v.id === version)) {
          setVersion((versions.find((v) => !v.unstable) ?? versions[0])?.id ?? "");
        }
      })
      .catch(() => !cancelled && setError("Could not load versions."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
    // `version` is intentionally omitted: refetching on every click would thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [software]);

  const dirty = software !== currentSoftware || version !== currentVersion;
  const shown = showUnstable ? versions : versions.filter((v) => !v.unstable);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/servers/${serverId}`, {
        method: "PATCH",
        json: { software, version },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {saved && (
        <Alert tone="success" title="Saved">
          {online
            ? "Restart the server to install the new jar."
            : "The new jar installs on the next start."}
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Server software"
          description="Switching keeps your world, plugins, players and settings."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {available.map((s) => (
            <button
              key={s.id}
              onClick={() => setSoftware(s.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                software === s.id
                  ? "border-grass-500 bg-grass-500/8"
                  : "border-ink-700 bg-ink-850/50 hover:border-ink-600"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{s.name}</span>
                <div className="flex items-center gap-1.5">
                  {s.id === currentSoftware && <Badge tone="grass">Current</Badge>}
                  {software === s.id && <Check className="size-4 text-grass-400" />}
                </div>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{s.blurb}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Minecraft version"
          description="Every version the project has ever published."
          action={
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-400">
              <input
                type="checkbox"
                checked={showUnstable}
                onChange={(e) => setShowUnstable(e.target.checked)}
                className="size-4 rounded border-ink-600 bg-ink-850 accent-grass-500"
              />
              Snapshots
            </label>
          }
        />
        {loading ? (
          <div className="grid place-items-center py-14 text-ink-500">
            <Spinner className="size-6" />
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto p-3">
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {shown.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVersion(v.id)}
                  className={`rounded-lg border px-2 py-2 text-center font-mono text-xs transition-colors ${
                    version === v.id
                      ? "border-grass-500 bg-grass-500/12 text-grass-300"
                      : "border-transparent bg-ink-850 text-ink-300 hover:bg-ink-800"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {dirty && (
        <Alert tone="warn" title="Version changes can break worlds">
          Downgrading is not supported by Minecraft itself — take a backup first if you are
          moving to an older version.
        </Alert>
      )}

      <div className="flex justify-end">
        <Button onClick={save} loading={saving} disabled={!dirty || !version}>
          <RefreshCw className="size-4" />
          Apply {software !== currentSoftware ? "software" : "version"} change
        </Button>
      </div>
    </div>
  );
}
