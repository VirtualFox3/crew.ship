import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { supabase } from "./supabase";
import "./App.css";

type View = "servers" | "new" | "marketplace" | "crew" | "settings";
type Theme = "graphite" | "slate" | "ocean" | "forest" | "violet" | "ember" | "light";
type Software = "vanilla" | "paper" | "purpur" | "fabric" | "forge" | "neoforge";

type SystemStatus = {
  javaInstalled: boolean;
  javaVersion?: string;
  playitInstalled: boolean;
  playitPath?: string;
  dataDirectory: string;
  localAddress?: string;
};

type InstalledServer = {
  id: string;
  name: string;
  jarPath: string;
  software?: Software;
  gameVersion: string;
  loaderVersion: string;
  memoryMb: number;
  offlineMode?: boolean;
  cloudId?: string;
};

type ProcessStatus = { running: boolean; exitCode?: number };
type AddonKind = "mod" | "plugin";
type AddonResult = { id: string; title: string; description: string; iconUrl?: string; downloads: number };
type InstalledAddon = { name: string; filename: string; directory: string };
type Profile = { username: string; display_name?: string | null; avatar_url?: string | null };
type CrewMember = { user_id: string; role: "admin" | "moderator" | "viewer"; permissions?: string[] | null; profiles?: Profile | null };

const STORAGE_KEY = "howl-host-servers-v1";
const WELCOME_KEY = "crew-ship-welcome-seen";
const THEME_KEY = "crew-ship-theme";
const DISCORD_CALLBACK_URL = "crewship://auth/callback";

function savedServers(): InstalledServer[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseDiscordCallback(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "crewship:" && url.hostname === "auth" && url.pathname === "/callback" ? url : undefined;
  } catch {
    return undefined;
  }
}

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authMessage, setAuthMessage] = useState<string>();
  const [view, setView] = useState<View>("servers");
  const [system, setSystem] = useState<SystemStatus>();
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [versionQuery, setVersionQuery] = useState("");
  const [selectedSoftware, setSelectedSoftware] = useState<Software>("paper");
  const [selectedMemory, setSelectedMemory] = useState("4096");
  const [servers, setServers] = useState<InstalledServer[]>(savedServers);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [logsFor, setLogsFor] = useState<string>();
  const [logs, setLogs] = useState<string[]>([]);
  const [playitRunning, setPlayitRunning] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => localStorage.getItem(WELCOME_KEY) !== "true");
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "slate" || saved === "ocean" || saved === "forest" || saved === "violet" || saved === "ember" || saved === "graphite" ? saved : "graphite";
  });
  const [addonKind, setAddonKind] = useState<AddonKind>("mod");
  const [addonQuery, setAddonQuery] = useState("");
  const [addonResults, setAddonResults] = useState<AddonResult[]>([]);
  const [targetServerId, setTargetServerId] = useState("");
  const [crewServerId, setCrewServerId] = useState("");
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [moderatorName, setModeratorName] = useState("");

  const currentLogServer = useMemo(
    () => servers.find((server) => server.id === logsFor),
    [logsFor, servers],
  );

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const finishDiscordSignIn = async (value: string) => {
      const url = parseDiscordCallback(value);
      if (!url) return;
      const callbackError = url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? undefined;
      if (callbackError) {
        if (!disposed) setAuthMessage(callbackError);
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) return;
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (!disposed) setAuthMessage(exchangeError ? exchangeError.message : "Discord sign-in complete. Loading your ship…");
    };
    void getCurrent().then((urls) => Promise.all((urls ?? []).map(finishDiscordSignIn))).catch((cause) => setAuthMessage(errorMessage(cause)));
    void onOpenUrl((urls) => void Promise.all(urls.map(finishDiscordSignIn))).then((unsubscribe) => { unlisten = unsubscribe; }).catch((cause) => setAuthMessage(errorMessage(cause)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    void supabase
      .from("profiles")
      .select("username,display_name,avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));
  }, [user]);

  async function refreshSystem() {
    try {
      setSystem(await invoke<SystemStatus>("system_status"));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function refreshStatuses() {
    const statuses = await Promise.all(
      servers.map(async (server) => [
        server.id,
        (await invoke<ProcessStatus>("server_status", { id: server.id })).running,
      ] as const),
    );
    setRunning(Object.fromEntries(statuses));
  }

  useEffect(() => {
    void refreshSystem();
  }, []);

  useEffect(() => {
    setVersions([]);
    setSelectedVersion("");
    setVersionMenuOpen(false);
    setVersionQuery("");
    void invoke<string[]>("software_versions", { software: selectedSoftware })
      .then((items) => {
        setVersions(items);
        setSelectedVersion(items[0] ?? "");
      })
      .catch((cause) => setError(errorMessage(cause)));
  }, [selectedSoftware]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
    void refreshStatuses().catch(() => undefined);
    const timer = window.setInterval(() => void refreshStatuses().catch(() => undefined), 4_000);
    return () => window.clearInterval(timer);
  }, [servers]);

  useEffect(() => {
    if (!logsFor) return;
    const load = () => invoke<string[]>("server_logs", { id: logsFor }).then(setLogs);
    void load();
    const timer = window.setInterval(() => void load(), 1_500);
    return () => window.clearInterval(timer);
  }, [logsFor]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  async function install(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const software = String(data.get("software") ?? "paper") as Software;
    const gameVersion = String(data.get("version") ?? "");
    const memoryMb = Number(data.get("memory"));
    const offlineMode = true;
    const accepted = data.get("eula") === "on";
    if (!accepted) return setError("Accept the Minecraft EULA before installing.");
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (id.length < 3) id = `server-${Date.now().toString(36)}`;
    if (servers.some((server) => server.id === id)) id += `-${Date.now().toString(36).slice(-4)}`;

    setBusy("install");
    try {
      const installed = await invoke<Omit<InstalledServer, "name" | "memoryMb">>("install_server", {
        id,
        software,
        gameVersion,
        offlineMode,
      });
      const localServer: InstalledServer = { ...installed, name, memoryMb };
      if (user) {
        try {
          localServer.cloudId = await syncServer(localServer, user.id);
        } catch (cause) {
          setError(`Server installed locally. Crew sync needs attention: ${errorMessage(cause)}`);
        }
      }
      setServers((current) => [...current, localServer]);
      setNotice(`${name} is installed and ready.`);
      setView("servers");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function start(server: InstalledServer) {
    setBusy(server.id);
    setError(undefined);
    try {
      await invoke("start_server", {
        config: { id: server.id, jarPath: server.jarPath, memoryMb: server.memoryMb, software: server.software ?? "fabric" },
      });
      setRunning((current) => ({ ...current, [server.id]: true }));
      setNotice(`${server.name} is starting in the background.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function stop(server: InstalledServer) {
    setBusy(server.id);
    setError(undefined);
    try {
      await invoke("stop_server", { id: server.id });
      setRunning((current) => ({ ...current, [server.id]: false }));
      setNotice(`${server.name} saved and stopped.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function togglePlayit() {
    setBusy("playit");
    setError(undefined);
    try {
      const next = playitRunning
        ? await invoke<boolean>("stop_playit")
        : await invoke<boolean>("start_playit", { path: system?.playitPath ?? null });
      setPlayitRunning(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function openMods(server: InstalledServer) {
    setError(undefined);
    try {
      const directory = await invoke<string>("server_mods_directory", { id: server.id });
      await openPath(directory);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const compatibleServers = servers.filter((server) => addonKind === "mod"
    ? ["fabric", "forge", "neoforge"].includes(server.software ?? "fabric")
    : ["paper", "purpur"].includes(server.software ?? "fabric"));
  const compatibleLabel = addonKind === "mod" ? "Fabric, Forge, or NeoForge" : "Paper or Purpur";

  async function searchAddons(event?: FormEvent) {
    event?.preventDefault();
    const query = addonQuery.trim();
    if (!query) return;
    setBusy("addon-search");
    setError(undefined);
    try {
      setAddonResults(await invoke<AddonResult[]>("search_modrinth", { query, kind: addonKind }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function installAddon(addon: AddonResult) {
    const target = compatibleServers.find((server) => server.id === targetServerId) ?? compatibleServers[0];
    if (!target) return setError(`Create a compatible ${compatibleLabel} server first.`);
    setBusy(`addon-${addon.id}`);
    setError(undefined);
    try {
      const installed = await invoke<InstalledAddon>("install_modrinth_addon", {
        serverId: target.id,
        projectId: addon.id,
        kind: addonKind,
        gameVersion: target.gameVersion,
        loader: target.software,
      });
      setNotice(`${installed.name} installed to ${target.name}. Restart the server to load it.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function syncServer(server: InstalledServer, ownerId = user?.id) {
    if (!ownerId) throw new Error("Log in before syncing crew access.");
    if (server.cloudId) return server.cloudId;
    const subdomain = cloudSubdomain(ownerId, server.id);
    const { data: existing } = await supabase
      .from("servers")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("subdomain", subdomain)
      .maybeSingle();
    if (existing?.id) return String(existing.id);
    const { data, error: cloudError } = await supabase
      .from("servers")
      .insert({
        owner_id: ownerId,
        name: server.name,
        subdomain,
        software: server.software ?? "fabric",
        version: server.gameVersion,
        build: server.loaderVersion,
        memory_mb: server.memoryMb,
        online_mode: false,
        status: "offline",
      })
      .select("id")
      .single();
    if (cloudError) throw cloudError;
    return String(data.id);
  }

  async function syncAllServers() {
    if (!user) return;
    setBusy("crew-sync");
    setError(undefined);
    try {
      const synced = await Promise.all(servers.map(async (server) => ({
        ...server,
        cloudId: await syncServer(server, user.id),
      })));
      setServers(synced);
      setCrewServerId((current) => current || synced[0]?.id || "");
      setNotice("Crew access is ready for every local server.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function loadCrew(server = servers.find((item) => item.id === crewServerId)) {
    if (!server?.cloudId) {
      setCrewMembers([]);
      return;
    }
    const { data, error: crewError } = await supabase
      .from("server_access")
      .select("user_id,role,permissions,profiles(username,display_name,avatar_url)")
      .eq("server_id", server.cloudId)
      .order("created_at");
    if (crewError) throw crewError;
    setCrewMembers((data ?? []) as unknown as CrewMember[]);
  }

  useEffect(() => {
    if (view !== "crew") return;
    const server = servers.find((item) => item.id === crewServerId) ?? servers[0];
    if (server && server.id !== crewServerId) setCrewServerId(server.id);
    void loadCrew(server).catch((cause) => setError(errorMessage(cause)));
  }, [view, crewServerId, servers]);

  async function addModerator(event: FormEvent) {
    event.preventDefault();
    const server = servers.find((item) => item.id === crewServerId);
    if (!server?.cloudId) return setError("Sync this server before adding moderators.");
    const username = moderatorName.trim();
    if (!username) return;
    setBusy("invite-moderator");
    setError(undefined);
    try {
      const { data: invited, error: profileError } = await supabase
        .from("profiles")
        .select("id,username")
        .ilike("username", username)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!invited) throw new Error("No Crew.Ship account uses that username.");
      if (invited.id === user?.id) throw new Error("You already own this server.");
      const { error: inviteError } = await supabase.from("server_access").upsert({
        server_id: server.cloudId,
        user_id: invited.id,
        role: "moderator",
        permissions: ["console", "command", "power", "players", "addons", "files", "backups"],
      }, { onConflict: "server_id,user_id" });
      if (inviteError) throw inviteError;
      setModeratorName("");
      await loadCrew(server);
      setNotice(`${invited.username} is now a moderator for ${server.name}.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function removeModerator(member: CrewMember) {
    const server = servers.find((item) => item.id === crewServerId);
    if (!server?.cloudId) return;
    setBusy(`remove-${member.user_id}`);
    const { error: removeError } = await supabase
      .from("server_access")
      .delete()
      .eq("server_id", server.cloudId)
      .eq("user_id", member.user_id);
    if (removeError) setError(removeError.message);
    else await loadCrew(server);
    setBusy(undefined);
  }

  async function logOut() {
    setBusy("logout");
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    setBusy(undefined);
  }

  function finishWelcome() {
    localStorage.setItem(WELCOME_KEY, "true");
    setWelcomeOpen(false);
  }

  if (!authReady) return <div className="auth-loading"><div className="pixel-spinner" /><span>Preparing your ship…</span></div>;
  if (!user) return <LoginScreen externalMessage={authMessage} />;

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("servers")}>
          <span className="brand-mark"><i /><i /><i /><i /><i /></span>
          <span>CREW.SHIP</span>
        </button>
        <nav>
          <Nav active={view === "servers"} icon="▦" label="Servers" onClick={() => setView("servers")} />
          <Nav active={view === "new"} icon="＋" label="New server" onClick={() => setView("new")} />
          <Nav active={view === "marketplace"} icon="⬡" label="Marketplace" onClick={() => setView("marketplace")} />
          <Nav active={view === "crew"} icon="♟" label="Crew access" onClick={() => setView("crew")} />
          <Nav active={view === "settings"} icon="⚙" label="Ship settings" onClick={() => setView("settings")} />
        </nav>
        <div className="host-state">
          <span className="status-dot online" />
          <div><strong>This ship</strong><small>Local host online</small></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">LOCAL SHIP</span><strong>Your computer</strong></div>
          <div className="topbar-actions">
            <button className="theme-toggle" aria-label={`Switch to ${theme === "light" ? "graphite" : "light"} mode`} onClick={() => setTheme(theme === "light" ? "graphite" : "light")}>{theme === "light" ? "◐ GRAPHITE" : "☼ LIGHT"}</button>
            <span className="signed-in-user"><b>{profile?.username ?? user.email?.split("@")[0] ?? "Captain"}</b><small>SIGNED IN</small></span>
            <button className="panel-link logout-button" disabled={busy === "logout"} onClick={() => void logOut()}>LOG OUT</button>
          </div>
        </header>

        <section className="content">
          {error && <div className="alert error"><b>Something needs attention</b><span>{error}</span><button onClick={() => setError(undefined)}>×</button></div>}
          {notice && <div className="alert success"><b>Done</b><span>{notice}</span><button onClick={() => setNotice(undefined)}>×</button></div>}

          {view === "servers" && <>
            <PageTitle title="Your fleet" subtitle="Every world runs on your ship—not somebody else’s cloud." action={<button className="primary" onClick={() => setView("new")}>＋ NEW SERVER</button>} />
            <div className="metric-row">
              <Metric value={String(servers.length)} label="INSTALLED" />
              <Metric value={String(Object.values(running).filter(Boolean).length)} label="RUNNING" accent />
              <Metric value={system?.javaInstalled ? "READY" : "MISSING"} label="JAVA" />
              <Metric value={system?.localAddress ?? "CHECKING"} label="LOCAL SERVER IP" />
            </div>
            {!servers.length ? <EmptyState onCreate={() => setView("new")} /> : <div className="server-list">
              {servers.map((server) => <article className="server-card" key={server.id}>
                <div className="server-main">
                  <span className={`status-dot ${running[server.id] ? "online" : ""}`} />
                  <div><h3>{server.name}</h3><p>{softwareName(server.software ?? "fabric")} {server.loaderVersion} · Minecraft {server.gameVersion} · {Math.round(server.memoryMb / 1024)} GB · Premium + offline clients</p></div>
                </div>
                <div className="server-actions">
                  {["fabric", "forge", "neoforge"].includes(server.software ?? "fabric") && <button className="ghost" onClick={() => void openMods(server)}>MODS</button>}
                  <button className="ghost" onClick={() => setLogsFor(server.id)}>CONSOLE</button>
                  <button className={running[server.id] ? "danger-button" : "primary"} disabled={busy === server.id || !system?.javaInstalled} onClick={() => void (running[server.id] ? stop(server) : start(server))}>
                    {busy === server.id ? "WORKING…" : running[server.id] ? "■ STOP" : "▶ START"}
                  </button>
                </div>
              </article>)}
            </div>}
          </>}

          {view === "new" && <>
            <PageTitle title="Build a server" subtitle="Choose your engine. Crew.Ship downloads the official upstream build to this computer." />
            <form className="form-card" onSubmit={install}>
              <div className="step-number">01</div>
              <div className="form-grid">
                <label><span>SERVER NAME</span><input name="name" required minLength={2} maxLength={40} placeholder="Friends SMP" /></label>
                <label><span>SERVER SOFTWARE</span><ChoicePicker name="software" value={selectedSoftware} onChange={(value) => setSelectedSoftware(value as Software)} options={[{ value: "paper", label: "Paper — fast + plugins" }, { value: "purpur", label: "Purpur — configurable + plugins" }, { value: "fabric", label: "Fabric — lightweight mods" }, { value: "forge", label: "Forge — classic modpacks" }, { value: "neoforge", label: "NeoForge — modern modpacks" }, { value: "vanilla", label: "Vanilla — no add-ons" }]} /></label>
                <label><span>MINECRAFT VERSION</span><input type="hidden" name="version" value={selectedVersion} /><div className="version-picker"><button type="button" className="version-trigger" disabled={!versions.length} aria-expanded={versionMenuOpen} onClick={() => setVersionMenuOpen((open) => !open)}><strong>{selectedVersion || "Loading stable versions…"}</strong><span>⌄</span></button>{versionMenuOpen && <div className="version-menu"><input aria-label="Filter Minecraft versions" value={versionQuery} onChange={(event) => setVersionQuery(event.target.value)} placeholder="Filter versions…" /><div className="version-options" role="listbox">{versions.filter((version) => version.includes(versionQuery.trim())).slice(0, 30).map((version) => <button type="button" role="option" aria-selected={version === selectedVersion} className={version === selectedVersion ? "selected" : ""} key={version} onClick={() => { setSelectedVersion(version); setVersionMenuOpen(false); setVersionQuery(""); }}>{version}<small>{version === versions[0] ? "LATEST" : "STABLE"}</small></button>)}</div></div>}</div></label>
                <label><span>MEMORY</span><ChoicePicker name="memory" value={selectedMemory} onChange={setSelectedMemory} options={[{ value: "2048", label: "2 GB" }, { value: "4096", label: "4 GB · Recommended" }, { value: "6144", label: "6 GB" }, { value: "8192", label: "8 GB" }, { value: "12288", label: "12 GB" }]} /></label>
                <div className="fact"><b>REAL UPSTREAM BUILDS</b><p>Versions come live from Mojang and each loader's official release service—not a hard-coded list.</p></div>
                <div className="offline-check"><span><b>COMPATIBLE PLAYER ACCESS</b><small>Premium and offline clients can join. Add a whitelist or authentication plugin before sharing publicly.</small></span></div>
              </div>
              <label className="check"><input type="checkbox" name="eula" /><span>I accept the <button type="button" className="text-link" onClick={() => void openUrl("https://aka.ms/MinecraftEULA")}>Minecraft EULA</button>.</span></label>
              <div className="form-footer"><button type="button" className="ghost" onClick={() => setView("servers")}>CANCEL</button><button className="primary" disabled={busy === "install" || !versions.length}>{busy === "install" ? "DOWNLOADING…" : "INSTALL SERVER"}</button></div>
            </form>
          </>}

          {view === "marketplace" && <>
            <PageTitle title="Marketplace" subtitle="Find compatible mods and plugins, then install them straight into a local server." />
            <section className="market-toolbar">
              <div className="market-kinds"><button className={addonKind === "mod" ? "selected" : ""} onClick={() => { setAddonKind("mod"); setAddonResults([]); setTargetServerId(""); }}>MODS</button><button className={addonKind === "plugin" ? "selected" : ""} onClick={() => { setAddonKind("plugin"); setAddonResults([]); setTargetServerId(""); }}>PLUGINS</button></div>
              <form className="market-search" onSubmit={searchAddons}><input value={addonQuery} onChange={(event) => setAddonQuery(event.target.value)} placeholder={addonKind === "mod" ? "Search mods" : "Search plugins"} /><button className="primary" disabled={busy === "addon-search"}>{busy === "addon-search" ? "SEARCHING…" : "SEARCH MODRINTH"}</button></form>
              <label className="target-server"><span>INSTALL TO</span><ChoicePicker value={targetServerId} onChange={setTargetServerId} placeholder={compatibleServers.length ? "Choose automatically" : `No compatible ${compatibleLabel} server`} options={compatibleServers.map((server) => ({ value: server.id, label: `${server.name} · ${softwareName(server.software ?? "fabric")} ${server.gameVersion}` }))} /></label>
            </section>
            <div className="source-strip"><strong>MODRINTH</strong><span>One-click installs · {addonKind === "mod" ? "Fabric / Forge / NeoForge" : "Paper / Purpur"}</span><button className="ghost" onClick={() => void openUrl(addonKind === "mod" ? "https://www.curseforge.com/minecraft/mc-mods" : "https://www.curseforge.com/minecraft/bukkit-plugins")}>BROWSE CURSEFORGE ↗</button></div>
            {!addonResults.length ? <div className="market-empty"><span>⬡</span><h2>Search the catalog</h2><p>Results are filtered for mods or plugins. Crew.Ship picks a release compatible with the destination server.</p></div> : <div className="addon-grid">{addonResults.map((addon) => <article className="addon-card" key={addon.id}>{addon.iconUrl ? <img src={addon.iconUrl} alt="" /> : <div className="addon-placeholder">⬡</div>}<div><h3>{addon.title}</h3><p>{addon.description}</p><small>{addon.downloads.toLocaleString()} downloads · Modrinth</small></div><button className="primary" disabled={busy === `addon-${addon.id}` || !compatibleServers.length} onClick={() => void installAddon(addon)}>{busy === `addon-${addon.id}` ? "INSTALLING…" : "INSTALL"}</button></article>)}</div>}
          </>}

          {view === "crew" && <>
            <PageTitle title="Crew access" subtitle="Give trusted people moderator access to one server at a time." action={<button className="primary" disabled={!servers.length || busy === "crew-sync"} onClick={() => void syncAllServers()}>{busy === "crew-sync" ? "SYNCING…" : "SYNC LOCAL SERVERS"}</button>} />
            {!servers.length ? <EmptyState onCreate={() => setView("new")} /> : <div className="crew-layout">
              <section className="crew-control-card">
                <div className="card-heading"><span>SERVER</span><Pill ok={Boolean(servers.find((item) => item.id === crewServerId)?.cloudId)} /></div>
                <ChoicePicker value={crewServerId || servers[0]?.id || ""} onChange={setCrewServerId} options={servers.map((server) => ({ value: server.id, label: `${server.name} · ${softwareName(server.software ?? "fabric")}` }))} placeholder="Choose a server" />
                <div className="owner-row"><span className="crew-avatar captain">{(profile?.username ?? "C").slice(0, 2).toUpperCase()}</span><div><strong>{profile?.username ?? "You"}</strong><small>OWNER · FULL ACCESS</small></div></div>
                <form className="moderator-form" onSubmit={addModerator}><label><span>ADD MODERATOR BY USERNAME</span><div><input value={moderatorName} onChange={(event) => setModeratorName(event.target.value)} placeholder="minecraft_friend" /><button className="primary" disabled={busy === "invite-moderator" || !servers.find((item) => item.id === crewServerId)?.cloudId}>{busy === "invite-moderator" ? "ADDING…" : "ADD MODERATOR"}</button></div></label></form>
                {!servers.find((item) => item.id === crewServerId)?.cloudId && <p className="crew-hint">Sync local servers first. This creates the secure access record used by moderators.</p>}
              </section>
              <section className="crew-members-card">
                <div className="crew-members-heading"><div><span className="eyebrow">CURRENT ACCESS</span><h2>Server crew</h2></div><span className="member-count">{crewMembers.length} MODERATOR{crewMembers.length === 1 ? "" : "S"}</span></div>
                {crewMembers.length ? <div className="crew-member-list">{crewMembers.map((member) => <article key={member.user_id}><span className="crew-avatar">{(member.profiles?.username ?? "?").slice(0, 2).toUpperCase()}</span><div><strong>{member.profiles?.display_name || member.profiles?.username || "Unknown player"}</strong><small>@{member.profiles?.username ?? "unknown"} · {member.role.toUpperCase()}</small></div><span className="permission-summary">POWER · CONSOLE · PLAYERS · ADD-ONS</span><button className="ghost danger-text" disabled={busy === `remove-${member.user_id}`} onClick={() => void removeModerator(member)}>REMOVE</button></article>)}</div> : <div className="crew-empty"><span>♟</span><h3>No moderators yet</h3><p>Add someone by their Crew.Ship username. They need an account first.</p></div>}
              </section>
            </div>}
          </>}

          {view === "settings" && <>
            <PageTitle title="Host settings" subtitle="System checks and tunnel controls for this computer." />
            <div className="settings-grid">
              <section className="settings-card wide appearance-card"><div className="card-heading"><span>APPEARANCE</span><Pill ok /></div><h3>Choose your ship colors</h3><p>True neutral gray is the default. Pick a completely different mood whenever you want—the whole app updates instantly.</p><div className="theme-picker"><ThemeChoice theme="graphite" current={theme} label="True Gray" colors={["#181818", "#5d91f4", "#df596a"]} onSelect={setTheme} /><ThemeChoice theme="slate" current={theme} label="Cool Slate" colors={["#1b1e23", "#78a7ff", "#ef7180"]} onSelect={setTheme} /><ThemeChoice theme="ocean" current={theme} label="Deep Ocean" colors={["#0e151b", "#35a7ff", "#ff667d"]} onSelect={setTheme} /><ThemeChoice theme="forest" current={theme} label="Forest" colors={["#101a15", "#56c596", "#e2a84b"]} onSelect={setTheme} /><ThemeChoice theme="violet" current={theme} label="Ender" colors={["#171221", "#a77bff", "#ff628e"]} onSelect={setTheme} /><ThemeChoice theme="ember" current={theme} label="Nether" colors={["#1e1311", "#ff9d45", "#ef4c57"]} onSelect={setTheme} /><ThemeChoice theme="light" current={theme} label="Snow" colors={["#ffffff", "#245eea", "#d93f53"]} onSelect={setTheme} /></div></section>
              <section className="settings-card"><div className="card-heading"><span>JAVA RUNTIME</span><Pill ok={Boolean(system?.javaInstalled)} /></div><h3>{system?.javaInstalled ? "Ready" : "Java not found"}</h3><p>{system?.javaVersion ?? "Install Java 21 or newer to run recent Minecraft versions."}</p><button className="ghost" onClick={() => void openUrl("https://adoptium.net/temurin/releases/")}>GET JAVA ↗</button></section>
              <section className="settings-card"><div className="card-heading"><span>PUBLIC TUNNEL</span><Pill ok={playitRunning} /></div><h3>{playitRunning ? "Tunnel running" : "Playit.gg ready"}</h3><p>{system?.playitPath ?? "The official playit.gg agent downloads automatically the first time you start the tunnel."}</p><div className="button-row"><button className="primary" disabled={busy === "playit"} onClick={() => void togglePlayit()}>{busy === "playit" ? "PREPARING…" : playitRunning ? "STOP TUNNEL" : system?.playitInstalled ? "START TUNNEL" : "DOWNLOAD & START"}</button><button className="ghost" onClick={() => void openUrl("https://playit.gg")}>PLAYIT ACCOUNT ↗</button></div></section>
              <section className="settings-card"><div className="card-heading"><span>CREW ACCOUNT</span><Pill ok /></div><h3>{profile?.display_name || profile?.username || "Signed in"}</h3><p>{user.email} · Manage moderators directly from Crew access.</p><div className="button-row"><button className="primary" onClick={() => setView("crew")}>MANAGE CREW</button><button className="ghost" onClick={() => void logOut()}>LOG OUT</button></div></section>
              <section className="settings-card wide"><div className="card-heading"><span>SERVER STORAGE & ADD-ONS</span><Pill ok /></div><h3>Owned by your crew</h3><p className="mono">{system?.dataDirectory ?? "Loading…"}</p><p>Use Marketplace for one-click installs. Fabric, Forge, and NeoForge use mods; Paper and Purpur use plugins. Stop the server before changing a large modpack.</p></section>
            </div>
          </>}
        </section>
      </main>

      {logsFor && <div className="modal-backdrop" onMouseDown={() => setLogsFor(undefined)}><section className="console-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="status-dot online" /><strong>{currentLogServer?.name} / CONSOLE</strong></div><button onClick={() => setLogsFor(undefined)}>×</button></header><pre>{logs.length ? logs.join("\n") : "[Crew.Ship] Start the server to see console output."}</pre></section></div>}
      {welcomeOpen && <div className="welcome-backdrop"><section className="welcome-card"><div className="welcome-ship"><span /><span /><span /><span /></div><span className="eyebrow">WELCOME ABOARD</span><h1>Crew.Ship</h1><p>Build a Minecraft server on your own computer, add trusted moderators here, and keep the world in your hands.</p><div className="welcome-list"><span>▣ Local and public IP shown in the app</span><span>▣ One-click mods and plugins</span><span>▣ Vanilla, Paper, Purpur, Fabric, Forge and NeoForge</span></div><button className="primary" onClick={finishWelcome}>SET SAIL</button></section></div>}
    </div>
  );
}

function Nav({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}><span>{icon}</span>{label}</button>;
}

function PageTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><span className="eyebrow">CREW.SHIP DESKTOP</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function Metric({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return <div className={accent ? "metric accent" : "metric"}><strong>{value}</strong><span>{label}</span></div>;
}

function Pill({ ok }: { ok: boolean }) {
  return <span className={ok ? "pill ok" : "pill"}>{ok ? "● READY" : "○ OFF"}</span>;
}

function LoginScreen({ externalMessage }: { externalMessage?: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const username = String(data.get("username") ?? "").trim();
    setBusy(true);
    setMessage(undefined);
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { username } } });
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm the account, then log in here.");
    setBusy(false);
  }

  async function signInWithDiscord() {
    setBusy(true);
    setMessage(undefined);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: DISCORD_CALLBACK_URL, skipBrowserRedirect: true },
    });
    if (error) setMessage(error.message);
    else if (data.url) {
      try {
        await openUrl(data.url);
        setMessage("Finish signing in with Discord in your browser. Crew.Ship will reopen automatically.");
      } catch (cause) {
        setMessage(errorMessage(cause));
      }
    }
    setBusy(false);
  }

  return <main className="login-screen"><section className="login-visual"><div className="login-ship"><i /><i /><i /><i /><i /></div><span className="eyebrow">CREW.SHIP DESKTOP</span><h1>Your worlds.<br />Your machine.<br /><em>Your crew.</em></h1><p>Host Minecraft locally, install add-ons, and give trusted moderators only the controls they need.</p><div className="login-signal"><span /><b>LOCAL HOST READY</b></div></section><section className="login-panel"><div className="login-card"><span className="auth-step">CAPTAIN ACCESS</span><h2>{mode === "login" ? "Log in" : "Create account"}</h2><p>{mode === "login" ? "Use the same Crew.Ship account as your servers." : "Your account owns servers and moderator access."}</p>{(message || externalMessage) && <div className="auth-message">{message || externalMessage}</div>}<form onSubmit={submit}>{mode === "signup" && <label><span>USERNAME</span><input name="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" placeholder="minecraft_name" /></label>}<label><span>EMAIL</span><input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></label><label><span>PASSWORD</span><input name="password" type="password" required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="••••••••" /></label><button className="primary auth-submit" disabled={busy}>{busy ? "WORKING…" : mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}</button></form><div className="auth-divider"><span>OR</span></div><button className="discord-button" type="button" disabled={busy} onClick={() => void signInWithDiscord()}><DiscordIcon />{busy ? "OPENING DISCORD…" : "CONTINUE WITH DISCORD"}</button><button className="auth-switch" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(undefined); }}><span>{mode === "login" ? "NEW HERE?" : "ALREADY A CAPTAIN?"}</span><b>{mode === "login" ? "CREATE ACCOUNT →" : "LOG IN →"}</b></button></div></section></main>;
}

function DiscordIcon() {
  return <svg className="discord-icon" viewBox="0 0 71 55" aria-hidden="true"><path fill="currentColor" d="M60.1 4.3A58.5 58.5 0 0 0 45.5 0a40.2 40.2 0 0 0-1.9 3.9 54.5 54.5 0 0 0-16.3 0A39 39 0 0 0 25.4 0a58.2 58.2 0 0 0-14.6 4.3C1.6 18.1-.9 31.5.4 44.7a58.7 58.7 0 0 0 17.9 9.1 44.1 44.1 0 0 0 3.8-6.2 37.4 37.4 0 0 1-6-2.9c.5-.4.9-.7 1.3-1.1 11.6 5.4 24.2 5.4 35.7 0 .5.4.9.8 1.3 1.1a37.1 37.1 0 0 1-6 2.9 43.4 43.4 0 0 0 3.8 6.2 58.5 58.5 0 0 0 17.9-9.1c1.5-15.3-2.5-28.6-10-40.4ZM23.7 36.4c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.4 3.2 6.4 7.2s-2.8 7.2-6.4 7.2Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.4 3.2 6.4 7.2s-2.8 7.2-6.4 7.2Z" /></svg>;
}

type ChoiceOption = { value: string; label: string };

function ChoicePicker({ name, value, onChange, options, placeholder = "Choose an option" }: { name?: string; value: string; onChange: (value: string) => void; options: ChoiceOption[]; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  return <div className="choice-picker" ref={pickerRef}>{name && <input type="hidden" name={name} value={value} />}<button type="button" className="choice-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={!options.length} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? placeholder}</span><b>⌄</b></button>{open && <div className="choice-menu" role="listbox">{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}{option.value === value && <small>SELECTED</small>}</button>)}</div>}</div>;
}

function cloudSubdomain(ownerId: string, localId: string) {
  const value = `local-${ownerId.slice(0, 6)}-${localId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 32).replace(/-$/, "");
  return value.length >= 3 ? value : `local-${ownerId.slice(0, 8)}`;
}

function ThemeChoice({ theme, current, label, colors, onSelect }: { theme: Theme; current: Theme; label: string; colors: string[]; onSelect: (theme: Theme) => void }) {
  return <button type="button" className={current === theme ? "theme-choice selected" : "theme-choice"} onClick={() => onSelect(theme)}><span className="theme-swatches">{colors.map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{label}</strong><small>{current === theme ? "SELECTED" : "APPLY THEME"}</small></button>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="empty"><div className="empty-icon">⚓</div><h2>Your fleet is empty</h2><p>Create Vanilla, Paper, Purpur, Fabric, Forge, or NeoForge on this computer. Your world never leaves the machine.</p><button className="primary" onClick={onCreate}>BUILD YOUR FIRST SERVER</button></div>;
}

function softwareName(software: Software) {
  return ({ vanilla: "Vanilla", paper: "Paper", purpur: "Purpur", fabric: "Fabric", forge: "Forge", neoforge: "NeoForge" })[software];
}

export default App;
