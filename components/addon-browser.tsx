"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  Link2,
  Package,
  Power,
  Search,
  Trash2,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatCount } from "@/lib/utils";
import type { AddonKind, CatalogItem, ServerAddon } from "@/lib/types";

type Source = "modrinth" | "hangar" | "spigot";
type Tab = "browse" | "installed";

/**
 * Plugin and mod manager.
 *
 * Nothing here counts installs or gates a source behind a plan — searching all
 * three indexes and installing as many results as you like is the product.
 */
export function AddonBrowser({
  serverId,
  kind,
  loader,
  gameVersion,
  initialInstalled,
  serverOnline,
}: {
  serverId: string;
  kind: AddonKind;
  loader: string;
  gameVersion: string;
  initialInstalled: ServerAddon[];
  serverOnline: boolean;
}) {
  const [tab, setTab] = useState<Tab>("browse");
  const [source, setSource] = useState<Source>(kind === "mod" ? "modrinth" : "modrinth");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState(initialInstalled);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [matchVersion, setMatchVersion] = useState(true);

  const sources: { id: Source; label: string }[] =
    kind === "mod"
      ? [{ id: "modrinth", label: "Modrinth" }]
      : [
          { id: "modrinth", label: "Modrinth" },
          { id: "hangar", label: "Hangar" },
          { id: "spigot", label: "SpigotMC" },
        ];

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ source, kind, q: query });
      if (source === "modrinth") params.set("loader", loader);
      if (matchVersion) params.set("version", gameVersion);

      const { items } = await api<{ items: CatalogItem[] }>(`/api/catalog?${params}`);
      setItems(items);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [source, kind, query, loader, gameVersion, matchVersion]);

  // Debounce so typing does not hammer the upstream indexes.
  useEffect(() => {
    const timer = setTimeout(search, query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [search, query]);

  const installedIds = new Set(installed.map((a) => a.project_id));

  async function install(item: CatalogItem) {
    setWorking(item.projectId);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ installed: ServerAddon[]; dependencies: number }>(
        `/api/servers/${serverId}/addons`,
        {
          method: "POST",
          json: {
            source: item.source,
            kind,
            projectId: item.projectId,
            name: item.name,
            slug: item.slug,
            author: item.author,
            iconUrl: item.iconUrl,
          },
        },
      );
      setInstalled((cur) => [
        ...result.installed.filter((a) => !cur.some((c) => c.id === a.id)),
        ...cur,
      ]);
      setNotice(
        `Installed ${item.name}${
          result.dependencies ? ` and ${result.dependencies} dependencies` : ""
        }.${serverOnline ? " Restart to load it." : ""}`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(null);
    }
  }

  async function installFromUrl() {
    if (!manualUrl.trim()) return;
    setWorking("url");
    setError(null);
    try {
      const name = manualUrl.split("/").pop()?.replace(/\.jar$/i, "") || "Manual upload";
      const result = await api<{ installed: ServerAddon[] }>(
        `/api/servers/${serverId}/addons`,
        {
          method: "POST",
          json: { source: "url", kind, projectId: manualUrl, name, url: manualUrl },
        },
      );
      setInstalled((cur) => [...result.installed, ...cur]);
      setManualUrl("");
      setNotice(`Installed from URL.${serverOnline ? " Restart to load it." : ""}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(null);
    }
  }

  async function toggle(addon: ServerAddon) {
    setWorking(addon.id);
    try {
      await api(`/api/servers/${serverId}/addons`, {
        method: "PATCH",
        json: { addon: addon.id, enabled: !addon.enabled },
      });
      setInstalled((cur) =>
        cur.map((a) => (a.id === addon.id ? { ...a, enabled: !a.enabled } : a)),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(null);
    }
  }

  async function remove(addon: ServerAddon) {
    setWorking(addon.id);
    try {
      await api(`/api/servers/${serverId}/addons?addon=${addon.id}`, { method: "DELETE" });
      setInstalled((cur) => cur.filter((a) => a.id !== addon.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(null);
    }
  }

  const noun = kind === "mod" ? "mods" : "plugins";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-ink-700 bg-ink-900 p-1">
          {(["browse", "installed"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                tab === t ? "bg-grass-500 text-ink-950" : "text-ink-400 hover:text-ink-100"
              }`}
            >
              {t === "installed" ? `Installed (${installed.length})` : `Browse ${noun}`}
            </button>
          ))}
        </div>
        <Badge tone="grass">Unlimited installs</Badge>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {tab === "browse" ? (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Search" className="min-w-56 flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={
                      kind === "mod" ? "create, sodium, jei…" : "essentials, luckperms, worldedit…"
                    }
                    className="pl-9"
                  />
                </div>
              </Field>

              <Field label="Source" className="w-40">
                <Select value={source} onChange={(e) => setSource(e.target.value as Source)}>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <label className="mb-2.5 flex cursor-pointer items-center gap-2 text-xs text-ink-400">
                <input
                  type="checkbox"
                  checked={matchVersion}
                  onChange={(e) => setMatchVersion(e.target.checked)}
                  className="size-4 rounded border-ink-600 bg-ink-850 accent-grass-500"
                />
                Only {gameVersion}
              </label>
            </div>
          </Card>

          {loading ? (
            <Card className="grid place-items-center py-20 text-ink-500">
              <Spinner className="size-6" />
            </Card>
          ) : items.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((item) => (
                <CatalogCard
                  key={`${item.source}-${item.projectId}`}
                  item={item}
                  installed={installedIds.has(item.projectId)}
                  working={working === item.projectId}
                  onInstall={() => install(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Package className="size-7" />}
              title="Nothing matched"
              description={`Try a different search, another source, or turn off the ${gameVersion} filter.`}
            />
          )}

          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field
                label="Install from a direct URL"
                hint="Any public .jar link — useful for private or unlisted builds."
                className="min-w-64 flex-1"
              >
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
                  <Input
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="https://example.com/MyPlugin.jar"
                    className="pl-9"
                  />
                </div>
              </Field>
              <Button
                className="mb-6"
                variant="secondary"
                loading={working === "url"}
                onClick={installFromUrl}
                disabled={!manualUrl.trim()}
              >
                Install
              </Button>
            </div>
          </Card>
        </>
      ) : installed.length ? (
        <Card>
          <CardHeader
            title={`${installed.length} installed`}
            description={
              serverOnline
                ? "Changes take effect after the next restart."
                : "Everything here loads on the next start."
            }
          />
          <ul className="divide-y divide-ink-800">
            {installed.map((addon) => (
              <li key={addon.id} className="flex items-center gap-3 px-5 py-3">
                <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-800">
                  {addon.icon_url ? (
                    // Remote icons vary wildly in size; plain img keeps it simple.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={addon.icon_url} alt="" className="size-full object-cover" />
                  ) : (
                    <Package className="size-4 text-ink-500" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {addon.name}
                    {!addon.enabled && <Badge tone="amber">Disabled</Badge>}
                  </p>
                  <p className="truncate font-mono text-xs text-ink-500">
                    {addon.filename}
                    {addon.version_name ? ` · ${addon.version_name}` : ""}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  loading={working === addon.id}
                  onClick={() => toggle(addon)}
                  title={addon.enabled ? "Disable" : "Enable"}
                >
                  <Power className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={working === addon.id}
                  onClick={() => remove(addon)}
                  title="Uninstall"
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState
          icon={<Package className="size-7" />}
          title={`No ${noun} installed`}
          description={`Browse the catalogue and install as many as you want — there is no cap.`}
          action={<Button onClick={() => setTab("browse")}>Browse {noun}</Button>}
        />
      )}
    </div>
  );
}

function CatalogCard({
  item,
  installed,
  working,
  onInstall,
}: {
  item: CatalogItem;
  installed: boolean;
  working: boolean;
  onInstall: () => void;
}) {
  return (
    <Card className="flex gap-3 p-4">
      <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink-800">
        {item.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.iconUrl} alt="" className="size-full object-cover" />
        ) : (
          <Package className="size-5 text-ink-500" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{item.name}</h3>
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-ink-500 hover:text-ink-300"
            title="Open project page"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>

        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-400">
          {item.summary}
        </p>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
            <Download className="size-3" />
            {formatCount(item.downloads)}
          </span>

          <Button
            size="sm"
            variant={installed ? "outline" : "primary"}
            loading={working}
            onClick={onInstall}
            disabled={installed}
          >
            {installed ? "Installed" : "Install"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
