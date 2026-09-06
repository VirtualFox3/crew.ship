import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { User } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { supabase } from "./supabase";
import "./App.css";

type View = "servers" | "server" | "new" | "marketplace" | "crew" | "settings";
type ServerTab = "server" | "options" | "console" | "log" | "players" | "software" | "files" | "worlds" | "backups" | "access";
type Theme = "graphite" | "slate" | "ocean" | "forest" | "violet" | "ember" | "light" | "custom";
type PlayitConnectMode = "setup" | "secret";
type Software = "vanilla" | "paper" | "purpur" | "fabric" | "forge" | "neoforge";

type SystemStatus = {
  javaInstalled: boolean;
  javaVersion?: string;
  javaMajors?: number[];
  playitInstalled: boolean;
  playitPath?: string;
  playitConfigured?: boolean;
  playitAccountLinked?: boolean;
  playitAgentLinked?: boolean;
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

type ProcessStatus = { running: boolean; ready: boolean; exitCode?: number | null };
type ServerAddress = { lanAddress?: string; publicAddress?: string; port: number; playitConfigured?: boolean };
const joinAddress = (address?: ServerAddress) => address?.publicAddress || address?.lanAddress;
type BackupItem = { id: string; name: string; path: string; sizeBytes: number; createdAt: number };
type AddonKind = "mod" | "plugin";
type AddonResult = { id: string; title: string; description: string; iconUrl?: string; downloads: number };
type InstalledAddon = { name: string; filename: string; directory: string; installedFiles: number };
type Profile = { username: string; display_name?: string | null; avatar_url?: string | null };
type CrewMember = { user_id: string; role: "admin" | "moderator" | "viewer"; permissions?: string[] | null; profiles?: Profile | null };
type ServerInvite = { token: string; expires_at: string };
type ServerSettings = { maxPlayers: number; gamemode: string; difficulty: string; whiteList: boolean; allowFlight: boolean; forceGamemode: boolean; spawnProtection: number; requireResourcePack: boolean; resourcePack: string; resourcePackPrompt: string; keepInventory: boolean };

const STORAGE_KEY = "crew-ship-servers-v1";
const LEGACY_STORAGE_KEY = "howl-host-servers-v1";
const WELCOME_KEY = "crew-ship-welcome-seen";
const THEME_KEY = "crew-ship-theme";
const CUSTOM_THEME_KEY = "crew-ship-custom-theme";
const DISCORD_CALLBACK_URL = "crewship://auth/callback";

function savedServers(): InstalledServer[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function colorMix(foreground: string, background: string, amount: number) {
  const toRgb = (value: string) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const [fr, fg, fb] = toRgb(foreground);
  const [br, bg, bb] = toRgb(background);
  const channel = (front: number, back: number) => Math.round(front * (1 - amount) + back * amount).toString(16).padStart(2, "0");
  return `#${channel(fr, br)}${channel(fg, bg)}${channel(fb, bb)}`;
}

function parseDiscordCallback(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "crewship:" && url.hostname === "auth" && url.pathname === "/callback" ? url : undefined;
  } catch {
    return undefined;
  }
}

function parseInviteLink(value: string) {
  try {
    const url = new URL(value);
    const token = url.protocol === "crewship:" && url.hostname === "invite" ? url.searchParams.get("token") : null;
    return token && /^[0-9a-f-]{36}$/i.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

function savedCustomTheme() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_THEME_KEY) ?? "{}");
    return { canvas: parsed.canvas ?? "#222831", paper: parsed.paper ?? "#303841", blue: parsed.blue ?? "#4d8dff", red: parsed.red ?? "#ef5c76" };
  } catch {
    return { canvas: "#222831", paper: "#303841", blue: "#4d8dff", red: "#ef5c76" };
  }
}

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authMessage, setAuthMessage] = useState<string>();
  const [view, setView] = useState<View>("servers");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [serverTab, setServerTab] = useState<ServerTab>("server");
  const [settingsDraft, setSettingsDraft] = useState<ServerSettings>();
  const [consoleCommand, setConsoleCommand] = useState("");
  const [system, setSystem] = useState<SystemStatus>();
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [versionQuery, setVersionQuery] = useState("");
  const [selectedSoftware, setSelectedSoftware] = useState<Software>("paper");
  const [selectedMemory, setSelectedMemory] = useState("4096");
  const [servers, setServers] = useState<InstalledServer[]>(savedServers);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [addresses, setAddresses] = useState<Record<string, ServerAddress>>({});
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [logsFor, setLogsFor] = useState<string>();
  const [logs, setLogs] = useState<string[]>([]);
  const [playitRunning, setPlayitRunning] = useState(false);
  const [playitSecret, setPlayitSecret] = useState("");
  const [playitSetupCode, setPlayitSetupCode] = useState("");
  const [playitConnectMode, setPlayitConnectMode] = useState<PlayitConnectMode>("setup");
  const [playitClaim, setPlayitClaim] = useState<{ code: string; url: string }>();
  const [welcomeOpen, setWelcomeOpen] = useState(() => localStorage.getItem(WELCOME_KEY) !== "true");
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "slate" || saved === "ocean" || saved === "forest" || saved === "violet" || saved === "ember" || saved === "graphite" || saved === "custom" ? saved : "graphite";
  });
  const [customTheme, setCustomTheme] = useState(savedCustomTheme);
  const [addonKind, setAddonKind] = useState<AddonKind>("mod");
  const [addonQuery, setAddonQuery] = useState("");
  const [addonResults, setAddonResults] = useState<AddonResult[]>([]);
  const [targetServerId, setTargetServerId] = useState("");
  const [crewServerId, setCrewServerId] = useState("");
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [adminName, setAdminName] = useState("");
  const [inviteLink, setInviteLink] = useState<string>();
  const [usernameDraft, setUsernameDraft] = useState("");

  const currentLogServer = useMemo(
    () => servers.find((server) => server.id === logsFor),
    [logsFor, servers],
  );
  const activeServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) ?? servers[0],
    [selectedServerId, servers],
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
    const handleDeepLink = async (value: string) => {
      const inviteToken = parseInviteLink(value);
      if (inviteToken) {
        localStorage.setItem("crew-ship-pending-invite", inviteToken);
        if (!disposed) setAuthMessage("Admin invite received. Sign in to accept it.");
        return;
      }
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
    void getCurrent().then((urls) => Promise.all((urls ?? []).map(handleDeepLink))).catch((cause) => setAuthMessage(errorMessage(cause)));
    void onOpenUrl((urls) => void Promise.all(urls.map(handleDeepLink))).then((unsubscribe) => { unlisten = unsubscribe; }).catch((cause) => setAuthMessage(errorMessage(cause)));
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
      .then(({ data }) => {
        setProfile(data as Profile | null);
        setUsernameDraft((data as Profile | null)?.username ?? "");
      });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem("crew-ship-pending-invite");
    if (!token) return;
    localStorage.removeItem("crew-ship-pending-invite");
    void supabase.rpc("accept_server_admin_invite", { invite_token: token })
      .then(({ error: inviteError }) => {
        if (inviteError) setError(inviteError.message);
        else setNotice("You are now an admin for the invited server. The host keeps the server files on their computer.");
      });
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
        await invoke<ProcessStatus>("server_status", { id: server.id }),
      ] as const),
    );
    setRunning(Object.fromEntries(statuses.map(([id, status]) => [id, status.running])));
    setReady(Object.fromEntries(statuses.map(([id, status]) => [id, status.ready])));
    const nextAddresses = await Promise.all(servers.map(async (server) => [server.id, await invoke<ServerAddress>("server_address", { id: server.id })] as const));
    setAddresses(Object.fromEntries(nextAddresses));
  }

  async function refreshBackups(serverId: string) {
    try {
      setBackups(await invoke<BackupItem[]>("list_backups", { id: serverId }));
    } catch (cause) {
      setError(errorMessage(cause));
    }
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
    if (view !== "server" || !activeServer || !["console", "log", "players"].includes(serverTab)) return;
    const load = () => invoke<string[]>("server_logs", { id: activeServer.id }).then(setLogs);
    void load().catch(() => undefined);
    const timer = window.setInterval(() => void load().catch(() => undefined), 1_500);
    return () => window.clearInterval(timer);
  }, [view, activeServer, serverTab]);

  useEffect(() => {
    if (view === "server" && serverTab === "backups" && activeServer) void refreshBackups(activeServer.id);
  }, [view, serverTab, activeServer?.id]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(customTheme));
  }, [customTheme]);

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
      const status = await invoke<ProcessStatus>("start_server", {
        config: { id: server.id, jarPath: server.jarPath, memoryMb: server.memoryMb, software: server.software ?? "fabric", gameVersion: server.gameVersion },
      });
      setRunning((current) => ({ ...current, [server.id]: status.running }));
      setReady((current) => ({ ...current, [server.id]: status.ready }));
      if (status.running) setNotice(`${server.name} is starting. Wait for Online before connecting.`);
      else {
        setError(`${server.name} stopped during launch${status.exitCode !== undefined ? ` (exit ${status.exitCode})` : ""}. Open Console to see the loader error.`);
        setLogsFor(server.id);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function openServer(server: InstalledServer, tab: ServerTab = "server") {
    setSelectedServerId(server.id);
    setServerTab(tab);
    setView("server");
    if (tab === "options") {
      try {
        setSettingsDraft(await invoke<ServerSettings>("server_settings", { id: server.id }));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    }
  }

  async function saveServerSettings() {
    if (!activeServer || !settingsDraft) return;
    setBusy("server-settings");
    setError(undefined);
    try {
      await invoke("save_server_settings", { id: activeServer.id, settings: settingsDraft });
      if (running[activeServer.id]) {
        await invoke("send_server_command", { id: activeServer.id, command: `gamerule keepInventory ${settingsDraft.keepInventory ? "true" : "false"}` });
      }
      setNotice("Server properties saved. Restart the server for all changes to apply.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function sendConsoleCommand(event: FormEvent) {
    event.preventDefault();
    if (!activeServer || !consoleCommand.trim()) return;
    try {
      await invoke("send_server_command", { id: activeServer.id, command: consoleCommand });
      setConsoleCommand("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function stop(server: InstalledServer) {
    setBusy(server.id);
    setError(undefined);
    try {
      const result = await invoke<ProcessStatus>("stop_server", { id: server.id });
      setRunning((current) => ({ ...current, [server.id]: false }));
      setReady((current) => ({ ...current, [server.id]: false }));
      if (result.exitCode === 0) setNotice(`${server.name} stopped cleanly.`);
      else setError(`${server.name} exited${result.exitCode != null ? ` with code ${result.exitCode}` : ""}. Check Console; a successful save was not confirmed.`);
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

  async function connectPlayit() {
    setBusy("playit");
    setError(undefined);
    try {
      await invoke("configure_playit", { secret: playitSecret });
      setPlayitSecret("");
      await invoke<boolean>("start_playit", { path: system?.playitPath ?? null });
      setPlayitRunning(true);
      await refreshSystem();
      setNotice("Playit agent saved locally and started. Create a Minecraft Java tunnel in Playit that forwards to this server's local port, then paste its public address in the server overview.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function connectPlayitWithCode() {
    setBusy("playit");
    setError(undefined);
    try {
      await invoke("configure_playit_setup_code", { code: playitSetupCode });
      setPlayitSetupCode("");
      await refreshSystem();
      setNotice("Account linked. Next, select LINK THIS COMPUTER to approve Crew.Ship once.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function beginPlayitAgentLink() {
    setBusy("playit");
    setError(undefined);
    try {
      const claim = await invoke<{ code: string; url: string }>("begin_playit_agent_claim");
      setPlayitClaim(claim);
      await openUrl(claim.url);
      setNotice("Approve Crew.Ship as the local Playit agent in your browser, then come back and select CHECK APPROVAL.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function finishPlayitAgentLink() {
    if (!playitClaim) return;
    setBusy("playit");
    setError(undefined);
    try {
      await invoke<boolean>("finish_playit_agent_claim", { code: playitClaim.code });
      setPlayitClaim(undefined);
      setPlayitRunning(true);
      await refreshSystem();
      setNotice("Crew.Ship is linked as your local Playit agent. New tunnel addresses are created automatically when you start servers.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function disconnectPlayit() {
    setBusy("playit");
    setError(undefined);
    try {
      await invoke("disconnect_playit");
      setPlayitSecret("");
      setPlayitSetupCode("");
      setPlayitClaim(undefined);
      setPlayitRunning(false);
      await refreshSystem();
      setPlayitConnectMode("setup");
      setNotice("Playit was disconnected from this computer.");
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
      setNotice(`${installed.name}${installed.installedFiles > 1 ? ` and ${installed.installedFiles - 1} required dependencies` : ""} installed to ${target.name}. Restart the server to load it.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function createBackup(server: InstalledServer) {
    setBusy(`backup-${server.id}`);
    setError(undefined);
    try {
      const backup = await invoke<BackupItem>("create_backup", { id: server.id });
      await refreshBackups(server.id);
      setNotice(`Backup created: ${backup.name}`);
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
    const username = adminName.trim();
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
        role: "admin",
        permissions: ["console", "command", "power", "players", "addons", "files", "backups", "worlds", "settings"],
      }, { onConflict: "server_id,user_id" });
      if (inviteError) throw inviteError;
      setAdminName("");
      await loadCrew(server);
      setNotice(`${invited.username} is now an admin for ${server.name}.`);
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

  async function createAdminInvite() {
    const server = servers.find((item) => item.id === crewServerId);
    if (!server?.cloudId || !user) return setError("Sync this server before creating an admin invite.");
    setBusy("create-invite");
    setError(undefined);
    try {
      const { data, error: inviteError } = await supabase
        .from("server_invites")
        .insert({ server_id: server.cloudId, created_by: user.id, role: "admin" })
        .select("token,expires_at")
        .single();
      if (inviteError) throw inviteError;
      const link = `crewship://invite?token=${(data as ServerInvite).token}`;
      setInviteLink(link);
      await navigator.clipboard?.writeText(link);
      setNotice("One-use admin invite copied. It expires in 7 days.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function deleteServer(server: InstalledServer) {
    if (!window.confirm(`Delete ${server.name}? This permanently removes its local world, mods, and server files.`)) return;
    setBusy(`delete-${server.id}`);
    setError(undefined);
    try {
      await invoke("delete_server", { id: server.id });
      if (server.cloudId) {
        const { error: cloudError } = await supabase.from("servers").delete().eq("id", server.cloudId);
        if (cloudError) throw cloudError;
      }
      setServers((current) => current.filter((item) => item.id !== server.id));
      setNotice(`${server.name} and its local files were deleted.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function saveUsername(event: FormEvent) {
    event.preventDefault();
    const username = usernameDraft.trim();
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return setError("Username must be 3–24 letters, numbers, or underscores.");
    setBusy("username");
    const { data, error: updateError } = await supabase.from("profiles").update({ username, display_name: username }).eq("id", user?.id ?? "").select("username,display_name,avatar_url").single();
    if (updateError) setError(updateError.message);
    else {
      setProfile(data as Profile);
      setNotice("Crew.Ship username updated.");
    }
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

  const customThemeStyle = theme === "custom" ? {
    "--canvas": customTheme.canvas, "--paper": customTheme.paper, "--paper-2": colorMix(customTheme.paper, "#ffffff", 0.08), "--ink": "#f7fafc", "--muted": "#b9c2ce", "--line": colorMix(customTheme.paper, "#ffffff", 0.22), "--blue": customTheme.blue, "--blue-dark": colorMix(customTheme.blue, "#ffffff", 0.38), "--blue-soft": colorMix(customTheme.blue, customTheme.paper, 0.16), "--red": customTheme.red, "--red-dark": colorMix(customTheme.red, "#ffffff", 0.28), "--red-soft": colorMix(customTheme.red, customTheme.paper, 0.18), "--green": "#63d6a3"
  } as CSSProperties : undefined;

  return (
    <div className={`app-shell theme-${theme}`} style={customThemeStyle}>
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
              <Metric value={String(Object.values(ready).filter(Boolean).length)} label="ONLINE" accent />
              <Metric value={system?.javaInstalled ? "READY" : "MISSING"} label="JAVA" />
              <Metric value={system?.localAddress ?? "CHECKING"} label="LOCAL SERVER IP" />
            </div>
            {!servers.length ? <EmptyState onCreate={() => setView("new")} /> : <div className="server-list">
              {servers.map((server) => <article className="server-card" key={server.id}>
                <div className="server-main">
                  <span className={`status-dot ${ready[server.id] ? "online" : ""}`} />
                  <div><h3>{server.name}</h3><p>{softwareName(server.software ?? "fabric")} {server.loaderVersion} · Minecraft {server.gameVersion} · {Math.round(server.memoryMb / 1024)} GB · Premium + offline clients</p><p className="server-ip">{ready[server.id] ? `${addresses[server.id]?.publicAddress ? "PUBLIC IP" : "LAN IP"}: ${joinAddress(addresses[server.id]) ?? "CHECKING…"}` : running[server.id] ? "STARTING / STOPPING — CHECK CONSOLE" : "OFFLINE"}</p></div>
                </div>
                <div className="server-actions">
                  <button className="ghost" onClick={() => void openServer(server)}>MANAGE</button>
                  {["fabric", "forge", "neoforge"].includes(server.software ?? "fabric") && <button className="ghost" onClick={() => void openMods(server)}>MODS</button>}
                  <button className="ghost" onClick={() => setLogsFor(server.id)}>CONSOLE</button>
                  <button className="ghost danger-text" disabled={busy === `delete-${server.id}`} onClick={() => void deleteServer(server)}>{busy === `delete-${server.id}` ? "DELETING…" : "DELETE"}</button>
                  <button className={running[server.id] ? "danger-button" : "primary"} disabled={busy === server.id || !system?.javaInstalled} onClick={() => void (running[server.id] ? stop(server) : start(server))}>
                    {busy === server.id ? "WORKING…" : running[server.id] ? "■ STOP" : "▶ START"}
                  </button>
                </div>
              </article>)}
            </div>}
          </>}

          {view === "server" && (activeServer ? <>
            <PageTitle title={activeServer.name} subtitle={`${softwareName(activeServer.software ?? "fabric")} · Minecraft ${activeServer.gameVersion} · runs on this computer`} action={<button className={running[activeServer.id] ? "danger-button" : "primary"} onClick={() => void (running[activeServer.id] ? stop(activeServer) : start(activeServer))}>{running[activeServer.id] ? "■ STOP" : "▶ START"}</button>} />
            <section className="connection-focus" aria-label="Server connection address">
              <div className="connection-focus-copy"><span>{addresses[activeServer.id]?.publicAddress ? "YOUR PUBLIC SERVER IP" : "YOUR LAN SERVER IP"}</span><strong>{joinAddress(addresses[activeServer.id]) ?? "CHECKING ADDRESS…"}</strong><small>{addresses[activeServer.id]?.publicAddress ? "Saved Playit address. The tunnel must be running and mapped to this server's local port. Public reachability is not verified." : "LAN only. Add this server's Playit address below to share with internet players."}{!ready[activeServer.id] && " Server is not ready for players yet."}</small></div>
              <div className="connection-focus-actions"><button className="ghost" disabled={!joinAddress(addresses[activeServer.id])} onClick={() => navigator.clipboard?.writeText(joinAddress(addresses[activeServer.id]) ?? "")}>COPY IP</button><button className="primary" onClick={() => setView("settings")}>PLAYIT SETTINGS</button></div>
            </section>
            <div className="server-workspace">
              <aside className="server-tabs">
                {(["server", "options", "console", "log", "players", "software", "files", "worlds", "backups", "access"] as ServerTab[]).map((tab) => <button key={tab} className={serverTab === tab ? "active" : ""} onClick={() => void openServer(activeServer, tab)}>{serverTabIcon(tab)} {serverTabLabel(tab)}</button>)}
              </aside>
              <section className="server-detail-panel">
                {serverTab === "server" && <div className="detail-overview"><span className={`status-dot ${ready[activeServer.id] ? "online" : ""}`} /><h2>{ready[activeServer.id] ? "Online" : running[activeServer.id] ? "Starting / stopping" : "Offline"}</h2><p>{ready[activeServer.id] ? "Minecraft is ready for players." : running[activeServer.id] ? "Minecraft has not confirmed readiness. Check Console for progress." : "Start this server to accept players."}</p><div className="detail-actions"><button className="ghost" onClick={() => void openServer(activeServer, "console")}>OPEN CONSOLE</button><button className="ghost" onClick={() => void openServer(activeServer, "options")}>SERVER OPTIONS</button><button className="ghost" onClick={() => void openServer(activeServer, "access")}>SHARE ACCESS</button></div><form key={activeServer.id} className="public-address-form" onSubmit={async (event) => { event.preventDefault(); const address = String(new FormData(event.currentTarget).get("publicAddress") ?? ""); try { await invoke("save_public_address", { id: activeServer.id, address }); await refreshStatuses(); setNotice("Public Playit address saved for this server."); } catch (cause) { setError(errorMessage(cause)); } }}><label htmlFor="public-address">PUBLIC SERVER ADDRESS</label><p>{addresses[activeServer.id]?.playitConfigured ? <>Playit starts automatically when this server starts. In Playit, make a <b>Minecraft Java</b> tunnel to <b>127.0.0.1:{addresses[activeServer.id]?.port ?? "…"}</b>, then paste the address it gives you.</> : <>Connect Playit in Ship settings to enable public hosting. Local port: <b>{addresses[activeServer.id]?.port ?? "…"}</b>.</>}</p><input id="public-address" name="publicAddress" defaultValue={addresses[activeServer.id]?.publicAddress ?? ""} placeholder="fnaf.example.playit.gg:12345" /><div className="detail-actions"><button className="primary" type="submit" disabled={!addresses[activeServer.id]?.playitConfigured}>SAVE ADDRESS</button>{addresses[activeServer.id]?.playitConfigured && <button className="ghost" type="button" onClick={() => void openUrl("https://playit.gg/account/tunnels")}>OPEN PLAYIT TUNNELS ↗</button>}</div></form></div>}
                {serverTab === "options" && (settingsDraft ? <div className="property-editor"><div className="property-heading"><span>SERVER.PROPERTIES</span><p>Saved locally. Restart the server to apply startup settings.</p></div><div className="property-grid"><NumberProperty label="Slots" value={settingsDraft.maxPlayers} min={1} max={500} onChange={(maxPlayers) => setSettingsDraft({ ...settingsDraft, maxPlayers })} /><SelectProperty label="Gamemode" value={settingsDraft.gamemode} choices={["survival", "creative", "adventure", "spectator"]} onChange={(gamemode) => setSettingsDraft({ ...settingsDraft, gamemode })} /><SelectProperty label="Difficulty" value={settingsDraft.difficulty} choices={["peaceful", "easy", "normal", "hard"]} onChange={(difficulty) => setSettingsDraft({ ...settingsDraft, difficulty })} /><ToggleProperty label="Whitelist" hint="Only approved players may join." value={settingsDraft.whiteList} onChange={(whiteList) => setSettingsDraft({ ...settingsDraft, whiteList })} /><ToggleProperty label="Keep inventory" hint="Players keep items after death." value={settingsDraft.keepInventory} onChange={(keepInventory) => setSettingsDraft({ ...settingsDraft, keepInventory })} /><ToggleProperty label="Fly" hint="Allow flight without a kick." value={settingsDraft.allowFlight} onChange={(allowFlight) => setSettingsDraft({ ...settingsDraft, allowFlight })} /><ToggleProperty label="Force gamemode" hint="Apply selected gamemode on join." value={settingsDraft.forceGamemode} onChange={(forceGamemode) => setSettingsDraft({ ...settingsDraft, forceGamemode })} /><NumberProperty label="Spawn protection" value={settingsDraft.spawnProtection} min={0} max={128} onChange={(spawnProtection) => setSettingsDraft({ ...settingsDraft, spawnProtection })} /><ToggleProperty label="Resource pack required" hint="Require the pack URL below." value={settingsDraft.requireResourcePack} onChange={(requireResourcePack) => setSettingsDraft({ ...settingsDraft, requireResourcePack })} /><label className="property-field"><span>RESOURCE PACK URL</span><input value={settingsDraft.resourcePack} onChange={(event) => setSettingsDraft({ ...settingsDraft, resourcePack: event.target.value })} placeholder="https://example.com/pack.zip" /></label><label className="property-field"><span>RESOURCE PACK PROMPT</span><input value={settingsDraft.resourcePackPrompt} onChange={(event) => setSettingsDraft({ ...settingsDraft, resourcePackPrompt: event.target.value })} placeholder="Optional message for players" /></label></div><button className="primary" disabled={busy === "server-settings"} onClick={() => void saveServerSettings()}>{busy === "server-settings" ? "SAVING…" : "SAVE OPTIONS"}</button></div> : <div className="market-empty"><span>⌛</span><h2>Loading options</h2></div>)}
                {serverTab === "console" && <div className="console-page"><header><span className="status-dot online" /><b>{activeServer.name} / CONSOLE</b></header><pre>{logs.length ? logs.join("\n") : "Start the server to see console output."}</pre><form onSubmit={sendConsoleCommand}><input value={consoleCommand} onChange={(event) => setConsoleCommand(event.target.value)} placeholder={running[activeServer.id] ? "Type a Minecraft command…" : "Start server to send commands"} disabled={!running[activeServer.id]} /><button className="primary" disabled={!running[activeServer.id]}>SEND</button></form></div>}
                {serverTab === "log" && <div className="console-page read-only"><header><b>LIVE LOG</b><button className="ghost" onClick={() => void openPath(activeServer.jarPath.substring(0, Math.max(activeServer.jarPath.lastIndexOf("\\"), activeServer.jarPath.lastIndexOf("/"))))}>OPEN LOG FOLDER</button></header><pre>{logs.length ? logs.join("\n") : "Logs will appear once the server starts."}</pre></div>}
                {serverTab === "players" && <div className="detail-section"><h2>Players</h2><p>Use the console command <code>list</code> to see the current players. Whitelist and player slots are in Options.</p><button className="primary" disabled={!running[activeServer.id]} onClick={() => { setConsoleCommand("list"); void openServer(activeServer, "console"); }}>CHECK PLAYERS</button></div>}
                {serverTab === "software" && <div className="detail-section"><h2>{softwareName(activeServer.software ?? "fabric")}</h2><p>Minecraft {activeServer.gameVersion} · build {activeServer.loaderVersion}</p><p>{["fabric", "forge", "neoforge"].includes(activeServer.software ?? "") ? "This server accepts compatible mods from Marketplace." : ["paper", "purpur"].includes(activeServer.software ?? "") ? "This server accepts compatible plugins from Marketplace." : "Vanilla has no add-on loader."}</p><button className="primary" onClick={() => setView("marketplace")}>OPEN MARKETPLACE</button></div>}
                {serverTab === "files" && <FolderPanel title="Server files" text="Open this server’s folder to manage configs, datapacks, and downloaded files." path={activeServer.jarPath} />}
                {serverTab === "worlds" && <FolderPanel title="Worlds" text="Your worlds are stored locally in the server folder. Stop the server before manually replacing a world." path={activeServer.jarPath} />}
                {serverTab === "backups" && <div className="detail-section"><h2>Backups</h2><p>Create a real ZIP copy of this server, including its world, properties, mods, plugins, and configuration. Stop the server first so Minecraft finishes saving.</p><div className="detail-actions"><button className="primary" disabled={running[activeServer.id] || busy === `backup-${activeServer.id}`} onClick={() => void createBackup(activeServer)}>{busy === `backup-${activeServer.id}` ? "CREATING BACKUP…" : "CREATE BACKUP"}</button><button className="ghost" onClick={async () => { try { await openPath(await invoke<string>("backups_directory", { id: activeServer.id })); } catch (cause) { setError(errorMessage(cause)); } }}>OPEN BACKUP FOLDER</button></div>{running[activeServer.id] && <p className="muted">Stop this server before creating a backup.</p>}<div className="backup-list">{backups.length ? backups.map((backup) => <article key={backup.id} className="backup-item"><div><b>{backup.name}</b><small>{new Date(backup.createdAt * 1000).toLocaleString()} · {(backup.sizeBytes / 1024 / 1024).toFixed(1)} MB</small></div><button className="ghost" onClick={() => void openPath(backup.path)}>OPEN</button></article>) : <p className="muted">No backups yet.</p>}</div></div>}
                {serverTab === "access" && <div className="detail-section"><h2>Share access</h2><p>Invite a trusted person by Crew.Ship username or generate a one-use admin link. Their account controls their access—your world stays on this computer.</p><button className="primary" onClick={() => { setCrewServerId(activeServer.id); setView("crew"); }}>MANAGE ACCESS</button></div>}
              </section>
            </div>
          </> : <EmptyState onCreate={() => setView("new")} />)}

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
            <PageTitle title="Crew access" subtitle="Give trusted people admin access to one server at a time." action={<button className="primary" disabled={!servers.length || busy === "crew-sync"} onClick={() => void syncAllServers()}>{busy === "crew-sync" ? "SYNCING…" : "SYNC LOCAL SERVERS"}</button>} />
            {!servers.length ? <EmptyState onCreate={() => setView("new")} /> : <div className="crew-layout">
              <section className="crew-control-card">
                <div className="card-heading"><span>SERVER</span><Pill ok={Boolean(servers.find((item) => item.id === crewServerId)?.cloudId)} /></div>
                <ChoicePicker value={crewServerId || servers[0]?.id || ""} onChange={setCrewServerId} options={servers.map((server) => ({ value: server.id, label: `${server.name} · ${softwareName(server.software ?? "fabric")}` }))} placeholder="Choose a server" />
                <div className="owner-row"><span className="crew-avatar captain">{(profile?.username ?? "C").slice(0, 2).toUpperCase()}</span><div><strong>{profile?.username ?? "You"}</strong><small>OWNER · FULL ACCESS</small></div></div>
                <form className="moderator-form" onSubmit={addModerator}><label><span>ADD ADMIN BY USERNAME</span><div><input value={adminName} onChange={(event) => setAdminName(event.target.value)} placeholder="minecraft_friend" /><button className="primary" disabled={busy === "invite-moderator" || !servers.find((item) => item.id === crewServerId)?.cloudId}>{busy === "invite-moderator" ? "ADDING…" : "ADD ADMIN"}</button></div></label></form>
                <button className="ghost invite-link-button" disabled={busy === "create-invite" || !servers.find((item) => item.id === crewServerId)?.cloudId} onClick={() => void createAdminInvite()}>{busy === "create-invite" ? "CREATING LINK…" : "COPY ADMIN INVITE LINK"}</button>
                {inviteLink && <input className="invite-link" readOnly value={inviteLink} aria-label="One-use admin invite link" onFocus={(event) => event.currentTarget.select()} />}
                {!servers.find((item) => item.id === crewServerId)?.cloudId && <p className="crew-hint">Sync local servers first. This creates the secure access record used by admins.</p>}
              </section>
              <section className="crew-members-card">
                <div className="crew-members-heading"><div><span className="eyebrow">CURRENT ACCESS</span><h2>Server crew</h2></div><span className="member-count">{crewMembers.length} ADMIN{crewMembers.length === 1 ? "" : "S"}</span></div>
                {crewMembers.length ? <div className="crew-member-list">{crewMembers.map((member) => <article key={member.user_id}><span className="crew-avatar">{(member.profiles?.username ?? "?").slice(0, 2).toUpperCase()}</span><div><strong>{member.profiles?.display_name || member.profiles?.username || "Unknown player"}</strong><small>@{member.profiles?.username ?? "unknown"} · {member.role.toUpperCase()}</small></div><span className="permission-summary">POWER · CONSOLE · PLAYERS · ADD-ONS</span><button className="ghost danger-text" disabled={busy === `remove-${member.user_id}`} onClick={() => void removeModerator(member)}>REMOVE</button></article>)}</div> : <div className="crew-empty"><span>♟</span><h3>No admins yet</h3><p>Add someone by username or send a one-use Crew.Ship invite link.</p></div>}
              </section>
            </div>}
          </>}

          {view === "settings" && <>
            <PageTitle title="Host settings" subtitle="System checks and tunnel controls for this computer." />
            <div className="settings-grid">
              <section className="settings-card wide appearance-card"><div className="card-heading"><span>APPEARANCE</span><Pill ok /></div><h3>Choose your ship colors</h3><p>True neutral gray is the default. Pick a completely different mood whenever you want—the whole app updates instantly.</p><div className="theme-picker"><ThemeChoice theme="graphite" current={theme} label="True Gray" colors={["#181818", "#5d91f4", "#df596a"]} onSelect={setTheme} /><ThemeChoice theme="slate" current={theme} label="Cool Slate" colors={["#1b1e23", "#78a7ff", "#ef7180"]} onSelect={setTheme} /><ThemeChoice theme="ocean" current={theme} label="Deep Ocean" colors={["#0e151b", "#35a7ff", "#ff667d"]} onSelect={setTheme} /><ThemeChoice theme="forest" current={theme} label="Forest" colors={["#101a15", "#56c596", "#dc6075"]} onSelect={setTheme} /><ThemeChoice theme="violet" current={theme} label="Ender" colors={["#171221", "#a77bff", "#ff628e"]} onSelect={setTheme} /><ThemeChoice theme="ember" current={theme} label="Nether" colors={["#1e1311", "#ff9d45", "#ef4c57"]} onSelect={setTheme} /><ThemeChoice theme="light" current={theme} label="Snow" colors={["#ffffff", "#245eea", "#d93f53"]} onSelect={setTheme} /><ThemeChoice theme="custom" current={theme} label="Your colors" colors={[customTheme.canvas, customTheme.blue, customTheme.red]} onSelect={setTheme} /></div><div className="custom-theme-controls"><label>BACKGROUND<input type="color" value={customTheme.canvas} onChange={(event) => { setTheme("custom"); setCustomTheme((current) => ({ ...current, canvas: event.target.value })); }} /></label><label>PANEL<input type="color" value={customTheme.paper} onChange={(event) => { setTheme("custom"); setCustomTheme((current) => ({ ...current, paper: event.target.value })); }} /></label><label>BLUE<input type="color" value={customTheme.blue} onChange={(event) => { setTheme("custom"); setCustomTheme((current) => ({ ...current, blue: event.target.value })); }} /></label><label>RED<input type="color" value={customTheme.red} onChange={(event) => { setTheme("custom"); setCustomTheme((current) => ({ ...current, red: event.target.value })); }} /></label></div></section>
              <section className="settings-card"><div className="card-heading"><span>JAVA RUNTIME</span><Pill ok={Boolean(system?.javaInstalled)} /></div><h3>{system?.javaInstalled ? "Ready" : "Downloads when needed"}</h3><p>{system?.javaMajors?.length ? `Installed: Java ${system.javaMajors.join(", ")}` : "Crew.Ship downloads the compatible Java runtime when you start a supported server."}</p><p>Forge and Fabric choose the exact compatible runtime automatically.</p></section>
              <section className="settings-card"><div className="card-heading"><span>PUBLIC TUNNEL</span><Pill ok={Boolean(system?.playitAccountLinked && system?.playitAgentLinked)} /></div><h3>{system?.playitAgentLinked ? "Playit connected" : "Connect Playit"}</h3>{!system?.playitAccountLinked && <><p>Choose one connection method. <b>Setup code</b> is the recommended Playit Third Party App flow.</p><div className="connection-mode"><button className={playitConnectMode === "setup" ? "selected" : "ghost"} onClick={() => setPlayitConnectMode("setup")}>SETUP CODE</button><button className={playitConnectMode === "secret" ? "selected" : "ghost"} onClick={() => setPlayitConnectMode("secret")}>AGENT SECRET</button></div>{playitConnectMode === "setup" ? <div className="tunnel-step"><input type="password" value={playitSetupCode} onChange={(event) => setPlayitSetupCode(event.target.value)} placeholder="One-time code from Playit" autoComplete="off" aria-label="Playit setup code" /><div className="button-row"><button className="primary" disabled={busy === "playit" || !playitSetupCode.trim()} onClick={() => void connectPlayitWithCode()}>{busy === "playit" ? "LINKING…" : "LINK ACCOUNT"}</button><button className="ghost" onClick={() => void openUrl("https://playit.gg/account/setup/wizard/new-account/third-party/third-party-select?partner=other")}>GET CODE ↗</button></div><small>Code expired? Generate a fresh code in Playit and paste it here.</small></div> : <div className="tunnel-step"><input type="password" value={playitSecret} onChange={(event) => setPlayitSecret(event.target.value)} placeholder="Playit agent secret" autoComplete="off" aria-label="Playit agent secret" /><button className="primary" disabled={busy === "playit" || !playitSecret.trim()} onClick={() => void connectPlayit()}>{busy === "playit" ? "CONNECTING…" : "CONNECT AGENT"}</button></div>}</>}{system?.playitAccountLinked && !system?.playitAgentLinked && <div className="tunnel-step"><p><b>One last step:</b> approve this computer as your Playit agent.</p>{!playitClaim ? <button className="primary" disabled={busy === "playit"} onClick={() => void beginPlayitAgentLink()}>LINK THIS COMPUTER</button> : <div className="button-row"><button className="primary" disabled={busy === "playit"} onClick={() => void finishPlayitAgentLink()}>{busy === "playit" ? "CHECKING…" : "I APPROVED IT"}</button><button className="ghost" onClick={() => void openUrl(playitClaim.url)}>OPEN PLAYIT ↗</button></div>}</div>}{system?.playitAgentLinked && <p>New servers get their public Minecraft address automatically when started.</p>}<div className="button-row">{system?.playitAgentLinked && <button className="ghost" disabled={busy === "playit"} onClick={() => void togglePlayit()}>{playitRunning ? "STOP AGENT" : "START AGENT"}</button>}{system?.playitConfigured && <button className="ghost danger-text" disabled={busy === "playit"} onClick={() => void disconnectPlayit()}>DISCONNECT</button>}</div></section>
              <section className="settings-card"><div className="card-heading"><span>CREW.SHIP ACCOUNT</span><Pill ok /></div><h3>{profile?.display_name || profile?.username || "Signed in"}</h3><p>{user.email} · Change your username or manage server admins.</p><form className="username-form" onSubmit={saveUsername}><input value={usernameDraft} onChange={(event) => setUsernameDraft(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" aria-label="Crew.Ship username" /><button className="ghost" disabled={busy === "username"}>{busy === "username" ? "SAVING…" : "SAVE NAME"}</button></form><div className="button-row"><button className="primary" onClick={() => setView("crew")}>MANAGE ADMINS</button><button className="ghost" onClick={() => void logOut()}>LOG OUT</button></div></section>
              <section className="settings-card wide"><div className="card-heading"><span>SERVER STORAGE & ADD-ONS</span><Pill ok /></div><h3>Owned by your crew</h3><p className="mono">{system?.dataDirectory ?? "Loading…"}</p><p>Use Marketplace for one-click installs. Fabric, Forge, and NeoForge use mods; Paper and Purpur use plugins. Stop the server before changing a large modpack.</p></section>
            </div>
          </>}
        </section>
      </main>

      {busy === "install" && <div className="launch-backdrop" role="status" aria-live="polite"><div className="launch-ship" aria-hidden="true"><i /><i /><i /><i /><i /></div><div className="launch-water" aria-hidden="true"><i /><i /><i /></div><h2>Preparing your world</h2><p>Downloading the server files and getting your ship ready.</p></div>}
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

function serverTabLabel(tab: ServerTab) {
  return ({ server: "Server", options: "Options", console: "Console", log: "Log", players: "Players", software: "Software", files: "Files", worlds: "Worlds", backups: "Backups", access: "Access" } as Record<ServerTab, string>)[tab];
}

function serverTabIcon(tab: ServerTab) {
  return ({ server: "◉", options: "⚙", console: "›_", log: "≡", players: "♟", software: "◆", files: "▣", worlds: "◌", backups: "↶", access: "♙" } as Record<ServerTab, string>)[tab];
}

function NumberProperty({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="property-field"><span>{label.toUpperCase()}</span><input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} /></label>;
}

function SelectProperty({ label, value, choices, onChange }: { label: string; value: string; choices: string[]; onChange: (value: string) => void }) {
  return <label className="property-field"><span>{label.toUpperCase()}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>;
}

function ToggleProperty({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-property"><span><b>{label}</b><small>{hint}</small></span><input aria-label={label} type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function FolderPanel({ title, text, path }: { title: string; text: string; path: string }) {
  const directory = path.substring(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
  return <div className="detail-section"><h2>{title}</h2><p>{text}</p><button className="primary" onClick={() => void openPath(directory)}>OPEN FOLDER</button></div>;
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
  return <div className="empty"><div className="empty-icon empty-ship" aria-hidden="true"><i /><i /><i /><i /><i /></div><h2>Your fleet is empty</h2><p>Create Vanilla, Paper, Purpur, Fabric, Forge, or NeoForge on this computer. Your world never leaves the machine.</p><button className="primary" onClick={onCreate}>BUILD YOUR FIRST SERVER</button></div>;
}

function softwareName(software: Software) {
  return ({ vanilla: "Vanilla", paper: "Paper", purpur: "Purpur", fabric: "Fabric", forge: "Forge", neoforge: "NeoForge" })[software];
}

export default App;
