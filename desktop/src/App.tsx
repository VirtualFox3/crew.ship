import { FormEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

type View = "servers" | "new" | "settings";
type Software = "vanilla" | "paper" | "fabric";

type SystemStatus = {
  javaInstalled: boolean;
  javaVersion?: string;
  playitInstalled: boolean;
  playitPath?: string;
  dataDirectory: string;
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

  async function install(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const software = String(data.get("software") ?? "paper") as Software;
    const gameVersion = String(data.get("version") ?? "");
    const memoryMb = Number(data.get("memory"));
    const offlineMode = data.get("offlineMode") === "on";
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

  async function toggleOfflineMode(server: InstalledServer) {
    const offlineMode = !server.offlineMode;
    setBusy(`mode-${server.id}`);
    setError(undefined);
    try {
      await invoke("set_offline_mode", { id: server.id, offlineMode });
      setServers((current) => current.map((item) => item.id === server.id ? { ...item, offlineMode } : item));
      setNotice(`${server.name} is now in ${offlineMode ? "offline" : "online"} mode. Restart it to apply the change.`);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("servers")}>
          <span className="brand-mark">H</span>
          <span>HOWL.HOST</span>
        </button>
        <nav>
          <Nav active={view === "servers"} icon="▦" label="Servers" onClick={() => setView("servers")} />
          <Nav active={view === "new"} icon="＋" label="New server" onClick={() => setView("new")} />
          <Nav active={view === "settings"} icon="⚙" label="Host settings" onClick={() => setView("settings")} />
        </nav>
        <div className="host-state">
          <span className="status-dot online" />
          <div><strong>This computer</strong><small>Native host online</small></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">LOCAL HOST</span><strong>Your computer</strong></div>
          <button className="panel-link" onClick={() => void openUrl("https://howl-host.vercel.app/dashboard")}>OPEN WEB PANEL ↗</button>
        </header>

        <section className="content">
          {error && <div className="alert error"><b>Something needs attention</b><span>{error}</span><button onClick={() => setError(undefined)}>×</button></div>}
          {notice && <div className="alert success"><b>Done</b><span>{notice}</span><button onClick={() => setNotice(undefined)}>×</button></div>}

          {view === "servers" && <>
            <PageTitle title="Your servers" subtitle="They run here—not in somebody else’s cloud." action={<button className="primary" onClick={() => setView("new")}>＋ NEW SERVER</button>} />
            <div className="metric-row">
              <Metric value={String(servers.length)} label="INSTALLED" />
              <Metric value={String(Object.values(running).filter(Boolean).length)} label="RUNNING" accent />
              <Metric value={system?.javaInstalled ? "READY" : "MISSING"} label="JAVA" />
              <Metric value={playitRunning ? "ACTIVE" : "BUILT IN"} label="PLAYIT.GG" />
            </div>
            {!servers.length ? <EmptyState onCreate={() => setView("new")} /> : <div className="server-list">
              {servers.map((server) => <article className="server-card" key={server.id}>
                <div className="server-main">
                  <span className={`status-dot ${running[server.id] ? "online" : ""}`} />
                  <div><h3>{server.name}</h3><p>{softwareName(server.software ?? "fabric")} {server.loaderVersion} · Minecraft {server.gameVersion} · {Math.round(server.memoryMb / 1024)} GB · {server.offlineMode ? "Offline mode" : "Account verified"}</p></div>
                </div>
                <div className="server-actions">
                  <button className="ghost" disabled={busy === `mode-${server.id}`} onClick={() => void toggleOfflineMode(server)}>{busy === `mode-${server.id}` ? "UPDATING…" : server.offlineMode ? "OFFLINE" : "ONLINE"}</button>
                  <button className="ghost" onClick={() => setLogsFor(server.id)}>CONSOLE</button>
                  <button className={running[server.id] ? "danger-button" : "primary"} disabled={busy === server.id || !system?.javaInstalled} onClick={() => void (running[server.id] ? stop(server) : start(server))}>
                    {busy === server.id ? "WORKING…" : running[server.id] ? "■ STOP" : "▶ START"}
                  </button>
                </div>
              </article>)}
            </div>}
          </>}

          {view === "new" && <>
            <PageTitle title="Install a Minecraft server" subtitle="Choose the software and version. Howl.Host downloads the real upstream server automatically." />
            <form className="form-card" onSubmit={install}>
              <div className="step-number">01</div>
              <div className="form-grid">
                <label><span>SERVER NAME</span><input name="name" required minLength={2} maxLength={40} placeholder="Friends SMP" /></label>
                <label><span>SERVER SOFTWARE</span><select name="software" value={selectedSoftware} onChange={(event) => setSelectedSoftware(event.target.value as Software)}><option value="paper">Paper — plugins + performance</option><option value="fabric">Fabric — mods</option><option value="vanilla">Vanilla — official</option></select></label>
                <label><span>MINECRAFT VERSION</span><select name="version" required disabled={!versions.length}>{versions.map((version) => <option key={version}>{version}</option>)}</select></label>
                <label><span>MEMORY</span><select name="memory" defaultValue="4096"><option value="2048">2 GB</option><option value="4096">4 GB</option><option value="6144">6 GB</option><option value="8192">8 GB</option><option value="12288">12 GB</option></select></label>
                <div className="fact"><b>REAL UPSTREAM BUILDS</b><p>Versions come live from Mojang, PaperMC, or Fabric—not a hard-coded list.</p></div>
                <label className="offline-check"><input type="checkbox" name="offlineMode" /><span><b>OFFLINE MODE</b><small>Allow unverified client accounts. Anyone can pick another player name, so use a whitelist or an authentication plugin.</small></span></label>
              </div>
              <label className="check"><input type="checkbox" name="eula" /><span>I accept the <button type="button" className="text-link" onClick={() => void openUrl("https://aka.ms/MinecraftEULA")}>Minecraft EULA</button>.</span></label>
              <div className="form-footer"><button type="button" className="ghost" onClick={() => setView("servers")}>CANCEL</button><button className="primary" disabled={busy === "install" || !versions.length}>{busy === "install" ? "DOWNLOADING…" : "INSTALL SERVER"}</button></div>
            </form>
          </>}

          {view === "settings" && <>
            <PageTitle title="Host settings" subtitle="System checks and tunnel controls for this computer." />
            <div className="settings-grid">
              <section className="settings-card"><div className="card-heading"><span>JAVA RUNTIME</span><Pill ok={Boolean(system?.javaInstalled)} /></div><h3>{system?.javaInstalled ? "Ready" : "Java not found"}</h3><p>{system?.javaVersion ?? "Install Java 21 or newer to run recent Minecraft versions."}</p><button className="ghost" onClick={() => void openUrl("https://adoptium.net/temurin/releases/")}>GET JAVA ↗</button></section>
              <section className="settings-card"><div className="card-heading"><span>PLAYIT.GG TUNNEL</span><Pill ok={playitRunning} /></div><h3>{playitRunning ? "Tunnel running" : "Built into Howl.Host"}</h3><p>{system?.playitPath ?? "The official playit.gg agent downloads automatically the first time you start the tunnel."}</p><div className="button-row"><button className="primary" disabled={busy === "playit"} onClick={() => void togglePlayit()}>{busy === "playit" ? "PREPARING…" : playitRunning ? "STOP TUNNEL" : system?.playitInstalled ? "START TUNNEL" : "DOWNLOAD & START"}</button><button className="ghost" onClick={() => void openUrl("https://playit.gg")}>PLAYIT ACCOUNT ↗</button></div></section>
              <section className="settings-card wide"><div className="card-heading"><span>SERVER STORAGE</span><Pill ok /></div><h3>Owned by you</h3><p className="mono">{system?.dataDirectory ?? "Loading…"}</p><p>Worlds, mods, configs, and backups remain on this computer.</p></section>
            </div>
          </>}
        </section>
      </main>

      {logsFor && <div className="modal-backdrop" onMouseDown={() => setLogsFor(undefined)}><section className="console-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="status-dot online" /><strong>{currentLogServer?.name} / CONSOLE</strong></div><button onClick={() => setLogsFor(undefined)}>×</button></header><pre>{logs.length ? logs.join("\n") : "[Howl.Host] Start the server to see console output."}</pre></section></div>}
    </div>
  );
}

function Nav({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}><span>{icon}</span>{label}</button>;
}

function PageTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><span className="eyebrow">HOWL.HOST DESKTOP</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function Metric({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return <div className={accent ? "metric accent" : "metric"}><strong>{value}</strong><span>{label}</span></div>;
}

function Pill({ ok }: { ok: boolean }) {
  return <span className={ok ? "pill ok" : "pill"}>{ok ? "● READY" : "○ OFF"}</span>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="empty"><div className="empty-icon">▦</div><h2>No servers installed</h2><p>Create a real Vanilla, Paper, or Fabric server on this computer. Your world never leaves the machine.</p><button className="primary" onClick={onCreate}>INSTALL YOUR FIRST SERVER</button></div>;
}

function softwareName(software: Software) {
  return software === "paper" ? "Paper" : software === "vanilla" ? "Vanilla" : "Fabric";
}

export default App;
