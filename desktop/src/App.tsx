import { FormEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

type View = "servers" | "new" | "settings";
type Theme = "dark" | "light";
type Software = "vanilla" | "paper" | "fabric";

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
};

type ProcessStatus = { running: boolean; exitCode?: number };

const STORAGE_KEY = "howl-host-servers-v1";
const WELCOME_KEY = "crew-ship-welcome-seen";
const THEME_KEY = "crew-ship-theme";

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

function App() {
  const [view, setView] = useState<View>("servers");
  const [system, setSystem] = useState<SystemStatus>();
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedSoftware, setSelectedSoftware] = useState<Software>("paper");
  const [servers, setServers] = useState<InstalledServer[]>(savedServers);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [logsFor, setLogsFor] = useState<string>();
  const [logs, setLogs] = useState<string[]>([]);
  const [playitRunning, setPlayitRunning] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => localStorage.getItem(WELCOME_KEY) !== "true");
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");

  const currentLogServer = useMemo(
    () => servers.find((server) => server.id === logsFor),
    [logsFor, servers],
  );

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
    void invoke<string[]>("software_versions", { software: selectedSoftware })
      .then(setVersions)
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
      setServers((current) => [...current, { ...installed, name, memoryMb }]);
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
        config: { id: server.id, jarPath: server.jarPath, memoryMb: server.memoryMb },
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

  function finishWelcome() {
    localStorage.setItem(WELCOME_KEY, "true");
    setWelcomeOpen(false);
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("servers")}>
          <span className="brand-mark"><i /><i /><i /></span>
          <span>CREW.SHIP</span>
        </button>
        <nav>
          <Nav active={view === "servers"} icon="▦" label="Servers" onClick={() => setView("servers")} />
          <Nav active={view === "new"} icon="＋" label="New server" onClick={() => setView("new")} />
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
            <button className="theme-toggle" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☼ LIGHT" : "◐ DARK"}</button>
            <button className="panel-link" onClick={() => void openUrl("https://howl-host.vercel.app/dashboard")}>OPEN CREW PANEL ↗</button>
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
                  {server.software === "fabric" && <button className="ghost" onClick={() => void openMods(server)}>MODS</button>}
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
                <label><span>SERVER SOFTWARE</span><select name="software" value={selectedSoftware} onChange={(event) => setSelectedSoftware(event.target.value as Software)}><option value="paper">Paper — plugins + performance</option><option value="fabric">Fabric — mods</option><option value="vanilla">Vanilla — official</option></select></label>
                <label><span>MINECRAFT VERSION</span><select name="version" required disabled={!versions.length}>{versions.map((version) => <option key={version}>{version}</option>)}</select></label>
                <label><span>MEMORY</span><select name="memory" defaultValue="4096"><option value="2048">2 GB</option><option value="4096">4 GB</option><option value="6144">6 GB</option><option value="8192">8 GB</option><option value="12288">12 GB</option></select></label>
                <div className="fact"><b>REAL UPSTREAM BUILDS</b><p>Versions come live from Mojang, PaperMC, or Fabric—not a hard-coded list.</p></div>
                <div className="offline-check"><span><b>COMPATIBLE PLAYER ACCESS</b><small>Premium and offline clients can join. Add a whitelist or authentication plugin before sharing publicly.</small></span></div>
              </div>
              <label className="check"><input type="checkbox" name="eula" /><span>I accept the <button type="button" className="text-link" onClick={() => void openUrl("https://aka.ms/MinecraftEULA")}>Minecraft EULA</button>.</span></label>
              <div className="form-footer"><button type="button" className="ghost" onClick={() => setView("servers")}>CANCEL</button><button className="primary" disabled={busy === "install" || !versions.length}>{busy === "install" ? "DOWNLOADING…" : "INSTALL SERVER"}</button></div>
            </form>
          </>}

          {view === "settings" && <>
            <PageTitle title="Host settings" subtitle="System checks and tunnel controls for this computer." />
            <div className="settings-grid">
              <section className="settings-card"><div className="card-heading"><span>JAVA RUNTIME</span><Pill ok={Boolean(system?.javaInstalled)} /></div><h3>{system?.javaInstalled ? "Ready" : "Java not found"}</h3><p>{system?.javaVersion ?? "Install Java 21 or newer to run recent Minecraft versions."}</p><button className="ghost" onClick={() => void openUrl("https://adoptium.net/temurin/releases/")}>GET JAVA ↗</button></section>
              <section className="settings-card"><div className="card-heading"><span>PUBLIC TUNNEL</span><Pill ok={playitRunning} /></div><h3>{playitRunning ? "Tunnel running" : "Playit.gg ready"}</h3><p>{system?.playitPath ?? "The official playit.gg agent downloads automatically the first time you start the tunnel."}</p><div className="button-row"><button className="primary" disabled={busy === "playit"} onClick={() => void togglePlayit()}>{busy === "playit" ? "PREPARING…" : playitRunning ? "STOP TUNNEL" : system?.playitInstalled ? "START TUNNEL" : "DOWNLOAD & START"}</button><button className="ghost" onClick={() => void openUrl("https://playit.gg")}>PLAYIT ACCOUNT ↗</button></div></section>
              <section className="settings-card"><div className="card-heading"><span>CREW ACCOUNT</span><Pill ok /></div><h3>Manage the crew</h3><p>Create a free Crew.Ship account to invite managers and choose exactly what they can control in the web panel.</p><div className="button-row"><button className="primary" onClick={() => void openUrl("https://howl-host.vercel.app/signup")}>CREATE ACCOUNT ↗</button><button className="ghost" onClick={() => void openUrl("https://howl-host.vercel.app/dashboard")}>MANAGE CREW ↗</button></div></section>
              <section className="settings-card wide"><div className="card-heading"><span>SERVER STORAGE & MODS</span><Pill ok /></div><h3>Owned by your crew</h3><p className="mono">{system?.dataDirectory ?? "Loading…"}</p><p>For Fabric servers, use the MODS button beside the server to open its real mods folder. Drop compatible .jar mods there while the server is stopped, then restart it.</p></section>
            </div>
          </>}
        </section>
      </main>

      {logsFor && <div className="modal-backdrop" onMouseDown={() => setLogsFor(undefined)}><section className="console-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="status-dot online" /><strong>{currentLogServer?.name} / CONSOLE</strong></div><button onClick={() => setLogsFor(undefined)}>×</button></header><pre>{logs.length ? logs.join("\n") : "[Crew.Ship] Start the server to see console output."}</pre></section></div>}
      {welcomeOpen && <div className="welcome-backdrop"><section className="welcome-card"><div className="welcome-ship"><span /><span /><span /></div><span className="eyebrow">WELCOME ABOARD</span><h1>Crew.Ship</h1><p>Build a Minecraft server on your own computer, invite your crew through the web panel, and keep the world in your hands.</p><div className="welcome-list"><span>▣ Local IP shown in the app</span><span>▣ Crew access and roles in the web panel</span><span>▣ Vanilla, Paper and Fabric available now</span></div><button className="primary" onClick={finishWelcome}>SET SAIL</button></section></div>}
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="empty"><div className="empty-icon">⚓</div><h2>Your fleet is empty</h2><p>Create a real Vanilla, Paper, or Fabric server on this computer. Your world never leaves the machine.</p><button className="primary" onClick={onCreate}>BUILD YOUR FIRST SERVER</button></div>;
}

function softwareName(software: Software) {
  return software === "paper" ? "Paper" : software === "vanilla" ? "Vanilla" : "Fabric";
}

export default App;
