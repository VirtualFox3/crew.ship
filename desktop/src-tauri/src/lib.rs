use serde::{Deserialize, Serialize};
mod runtime;
use serde_json::Value;
use rand::RngCore;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
const MOJANG_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const PAPER_API: &str = "https://fill.papermc.io/v3/projects/paper";
const PURPUR_API: &str = "https://api.purpurmc.org/v2/purpur";
const FORGE_METADATA: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const NEOFORGE_METADATA: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const PLAYIT_WINDOWS: &str = "https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64-signed.exe";
const PLAYIT_API: &str = "https://api.playit.gg";

#[derive(Default)]
struct HostState {
    servers: Mutex<HashMap<String, ManagedServer>>,
    playit: Mutex<Option<Child>>,
}

struct ManagedServer {
    child: Child,
    stdin: Option<ChildStdin>,
    logs: Arc<Mutex<VecDeque<String>>>,
    ready: Arc<std::sync::atomic::AtomicBool>,
    stopping: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemStatus {
    java_installed: bool,
    java_version: Option<String>,
    java_majors: Vec<u32>,
    playit_installed: bool,
    playit_path: Option<String>,
    playit_configured: bool,
    playit_account_linked: bool,
    playit_agent_linked: bool,
    data_directory: String,
    local_address: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledServer {
    id: String,
    jar_path: String,
    software: String,
    game_version: String,
    loader_version: String,
    offline_mode: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartConfig {
    id: String,
    jar_path: String,
    memory_mb: u32,
    software: String,
    game_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessStatus {
    running: bool,
    ready: bool,
    exit_code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerAddress {
    lan_address: Option<String>,
    public_address: Option<String>,
    port: u16,
    playit_configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupItem {
    id: String,
    name: String,
    path: String,
    size_bytes: u64,
    created_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerSettings {
    max_players: u16,
    gamemode: String,
    difficulty: String,
    white_list: bool,
    allow_flight: bool,
    force_gamemode: bool,
    spawn_protection: u16,
    require_resource_pack: bool,
    resource_pack: String,
    resource_pack_prompt: String,
    keep_inventory: bool,
}

#[derive(Deserialize)]
struct ModrinthSearchResponse {
    hits: Vec<ModrinthHit>,
}

#[derive(Deserialize)]
struct ModrinthHit {
    project_id: String,
    title: String,
    description: String,
    icon_url: Option<String>,
    downloads: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddonResult {
    id: String,
    title: String,
    description: String,
    icon_url: Option<String>,
    downloads: u64,
}

#[derive(Deserialize)]
struct ModrinthVersion {
    name: String,
    files: Vec<ModrinthFile>,
    #[serde(default)]
    dependencies: Vec<ModrinthDependency>,
}

#[derive(Deserialize)]
struct ModrinthDependency {
    project_id: Option<String>,
    dependency_type: String,
}

#[derive(Deserialize)]
struct ModrinthFile {
    url: String,
    filename: String,
    primary: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledAddon {
    name: String,
    filename: String,
    directory: String,
    installed_files: u32,
}

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn java_for_game(game: &str) -> Result<PathBuf, String> {
    let major = runtime::required_java(game)?;
    for path in runtime::java_candidates(major) {
        if let Some(output) = command_output(&path.to_string_lossy(), &["-version"]) {
            if runtime::java_major(&output) == Some(major) {
                return Ok(path);
            }
        }
    }
    Err(format!("Minecraft {game} needs Java {major}."))
}

fn install_java_for_game(game: &str) -> Result<PathBuf, String> {
    if let Ok(java) = java_for_game(game) {
        return Ok(java);
    }
    let major = runtime::required_java(game)?;
    // Temurin keeps current LTS and Java 8 runtimes at a stable public API.
    // Java 16 is end-of-life and has no current public binary endpoint.
    if major == 16 {
        return Err("Minecraft 1.17 needs Java 16. Its upstream runtime is end-of-life, so install a 64-bit Java 16 runtime once, then Crew.Ship will use it automatically.".into());
    }
    let local = std::env::var_os("LOCALAPPDATA")
        .ok_or("Could not locate Local AppData for the Java runtime.")?;
    let root = PathBuf::from(local)
        .join("Crew.Ship")
        .join("runtimes")
        .join(format!("java-{major}"));
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not prepare the Java runtime folder: {error}"))?;
    let archive = root.join(format!(".temurin-{major}.zip"));
    let endpoint = format!("https://api.adoptium.net/v3/binary/latest/{major}/ga/windows/x64/jre/hotspot/normal/eclipse");
    let bytes = http_get(&endpoint)?
        .bytes()
        .map_err(|error| format!("Could not download Java {major}: {error}"))?;
    fs::write(&archive, bytes).map_err(|error| format!("Could not save Java {major}: {error}"))?;
    let mut extract = Command::new("tar.exe");
    hidden(&mut extract);
    let result = extract
        .args(["-xf"])
        .arg(&archive)
        .args(["-C"])
        .arg(&root)
        .status();
    let _ = fs::remove_file(&archive);
    match result {
        Ok(status) if status.success() => java_for_game(game).map_err(|_| {
            format!("Java {major} downloaded but could not be verified. Try starting again.")
        }),
        Ok(_) => Err(format!(
            "Windows could not unpack Java {major}. Try starting again."
        )),
        Err(error) => Err(format!("Could not run Windows' Java unpacker: {error}")),
    }
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    hidden(&mut command);
    let output = command.args(args).output().ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let first = text.lines().find(|line| !line.trim().is_empty())?;
    Some(first.trim().to_owned())
}

fn http_get(url: impl AsRef<str>) -> Result<reqwest::blocking::Response, String> {
    reqwest::blocking::Client::builder()
        .user_agent("Crew.Ship/0.5 (https://github.com/VirtualFox3/Crew.Ship)")
        .build()
        .map_err(|error| format!("Could not create the download client: {error}"))?
        .get(url.as_ref())
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("Download request failed: {error}"))
}

fn find_playit() -> Option<PathBuf> {
    if let Some(found) = command_output("where.exe", &["playit.exe"]) {
        let path = PathBuf::from(found.lines().next()?.trim());
        if path.is_file() {
            return Some(path);
        }
    }

    let candidates = [
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("playit_gg").join("playit.exe")),
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .map(|path| path.join("Downloads").join("playit.exe")),
        std::env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .map(|path| path.join("playit.gg").join("playit.exe")),
    ];

    candidates.into_iter().flatten().find(|path| path.is_file())
}

fn app_servers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the app data folder: {error}"))?;
    let servers = root.join("servers");
    fs::create_dir_all(&servers)
        .map_err(|error| format!("Could not create the servers folder: {error}"))?;
    Ok(servers)
}

fn app_backups_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data.join("backups").join(id))
}

fn local_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let address = socket.local_addr().ok()?.ip();
    if address.is_loopback() {
        None
    } else {
        Some(address)
    }
}

fn local_address() -> Option<String> {
    local_ip().map(|address| format!("{address}:25565"))
}

fn bundled_playit_path(app: &AppHandle) -> Result<PathBuf, String> {
    let tools = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the app data folder: {error}"))?
        .join("tools");
    fs::create_dir_all(&tools)
        .map_err(|error| format!("Could not create the tools folder: {error}"))?;
    Ok(tools.join("playit.exe"))
}

fn playit_secret_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(bundled_playit_path(app)?.with_file_name("playit.toml"))
}

fn playit_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(bundled_playit_path(app)?.with_file_name("playit.log"))
}

fn playit_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(bundled_playit_path(app)?.with_file_name("playit-session.json"))
}

fn configured_playit_session(app: &AppHandle) -> Result<Option<String>, String> {
    let path = playit_session_path(app)?;
    let session = fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|value| value.get("session_key").and_then(Value::as_str).map(str::to_owned))
        .filter(|value| !value.trim().is_empty());
    Ok(session)
}

fn playit_api(path: &str, authorization: Option<&str>, body: Value) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not prepare the Playit connection: {error}"))?;
    // Match Playit's first-party web client for the setup-code flow.  These
    // harmless client-identification headers keep the API request shape
    // consistent without sending any account data beyond the requested body.
    let mut request = client
        .post(format!("{PLAYIT_API}{path}"))
        .header("x-ref-track", "crew.ship")
        .header("x-web-version", "crew.ship")
        .json(&body);
    if let Some(token) = authorization.filter(|value| !value.is_empty()) {
        request = request.header("Authorization", token);
    }
    let response = request.send().map_err(|error| format!("Playit is unavailable: {error}"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 => "That Playit setup code is invalid or expired. Generate a new Third Party App code in Playit, then paste it into Crew.Ship immediately.".into(),
            429 => "Playit is temporarily rate-limiting requests. Wait a minute, generate a fresh setup code, then try again.".into(),
            status => format!("Playit could not complete this request (HTTP {status}). Try again shortly."),
        });
    }
    let payload: Value = response.json().map_err(|error| format!("Playit returned an invalid response: {error}"))?;
    if payload.get("status").and_then(Value::as_str) == Some("success") {
        return Ok(payload.get("data").cloned().unwrap_or(Value::Null));
    }
    let detail = payload.get("data").and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .unwrap_or("Playit rejected this request.");
    Err(detail.to_owned())
}

fn claim_code() -> String {
    let mut bytes = [0u8; 5];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn playit_secret_is_valid(value: &str) -> bool {
    let value = value.trim();
    value.len() >= 16 && value.len() % 2 == 0 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn configured_playit_secret(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let path = playit_secret_path(app)?;
    let valid = fs::read_to_string(&path)
        .ok()
        .map(|contents| {
            let trimmed = contents.trim();
            if playit_secret_is_valid(trimmed) {
                true
            } else {
                trimmed
                    .strip_prefix("secret_key = ")
                    .and_then(|value| value.trim().strip_prefix('"'))
                    .and_then(|value| value.strip_suffix('"'))
                    .is_some_and(playit_secret_is_valid)
            }
        })
        .unwrap_or(false);
    Ok(valid.then_some(path))
}

fn playit_secret_value(app: &AppHandle) -> Result<Option<String>, String> {
    let Some(path) = configured_playit_secret(app)? else { return Ok(None); };
    let contents = fs::read_to_string(path).map_err(|error| format!("Could not read the local Playit agent key: {error}"))?;
    let key = contents.trim().strip_prefix("secret_key = ")
        .and_then(|value| value.trim().strip_prefix('"'))
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(contents.trim())
        .to_owned();
    Ok(playit_secret_is_valid(&key).then_some(key))
}

fn playit_endpoint(tunnel: &Value) -> Option<String> {
    for key in ["display_address", "assigned_domain", "custom_domain", "public_address"] {
        if let Some(value) = tunnel.get(key).and_then(Value::as_str).filter(|value| !value.is_empty()) {
            return Some(value.to_owned());
        }
    }
    let allocation = tunnel.get("alloc")?.get("data")?;
    let domain = allocation.get("assigned_domain")
        .or_else(|| allocation.get("assigned_srv"))
        .or_else(|| allocation.get("ip_hostname"))
        .and_then(Value::as_str)?;
    let port = allocation.get("port_start").and_then(Value::as_u64);
    Some(port.map(|port| format!("{domain}:{port}")).unwrap_or_else(|| domain.to_owned()))
}

/// Best-effort account-side provisioning. Failure must never stop local play.
fn provision_playit_tunnel(app: &AppHandle, server_id: &str, software: &str, port: u16) -> Result<Option<String>, String> {
    let Some(session_key) = configured_playit_session(app)? else { return Ok(None); };
    let Some(agent_secret) = playit_secret_value(app)? else { return Ok(None); };
    let agent = playit_api("/agents/rundata", Some(&format!("Agent-Secret {agent_secret}")), serde_json::json!({}))?;
    let agent_id = agent.get("agent_id").or_else(|| agent.get("id"))
        .or_else(|| agent.get("agent").and_then(|agent| agent.get("id")))
        .and_then(Value::as_str)
        .ok_or("Playit did not return this computer's agent id.")?;
    let list = playit_api("/tunnels/list", Some(&session_key), serde_json::json!({ "tunnel_id": null, "agent_id": agent_id }))?;
    let tunnels = list.get("tunnels").and_then(Value::as_array).cloned().unwrap_or_default();
    let name = format!("Crew.Ship {server_id}");
    let existing = tunnels.iter().find(|tunnel| tunnel.get("name").and_then(Value::as_str) == Some(name.as_str()));
    if let Some(tunnel) = existing {
        let id = tunnel.get("id").and_then(Value::as_str).ok_or("Playit returned a tunnel without an id.")?;
        playit_api("/tunnels/update", Some(&session_key), serde_json::json!({
            "tunnel_id": id, "local_ip": "127.0.0.1", "local_port": port,
            "agent_id": agent_id, "enabled": true
        }))?;
        return Ok(playit_endpoint(tunnel));
    }
    let tunnel_type = "minecraft-java";
    let created = playit_api("/tunnels/create", Some(&session_key), serde_json::json!({
        "name": name,
        "tunnel_type": tunnel_type,
        "tunnel_description": format!("Crew.Ship local server ({software})"),
        "port_type": "tcp", "port_count": 1,
        "origin": { "type": "agent", "data": { "agent_id": agent_id, "local_ip": "127.0.0.1", "local_port": port } },
        "enabled": true,
        "alloc": { "type": "region", "details": { "region": "global" } },
        "firewall_id": null, "proxy_protocol": null
    }))?;
    let id = created.get("id").and_then(Value::as_str).ok_or("Playit did not return a new tunnel id.")?;
    let refreshed = playit_api("/tunnels/list", Some(&session_key), serde_json::json!({ "tunnel_id": null, "agent_id": agent_id }))?;
    Ok(refreshed.get("tunnels").and_then(Value::as_array).and_then(|items| items.iter().find(|item| item.get("id").and_then(Value::as_str) == Some(id))).and_then(playit_endpoint))
}

fn ensure_playit(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = find_playit() {
        return Ok(path);
    }
    let bundled = bundled_playit_path(app)?;
    if bundled.is_file() {
        return Ok(bundled);
    }
    if let Ok(resource_root) = app.path().resource_dir() {
        let packaged = resource_root.join("resources").join("playit.exe");
        if packaged.is_file() {
            fs::copy(&packaged, &bundled).map_err(|error| {
                format!("Could not prepare the bundled playit.gg agent: {error}")
            })?;
            return Ok(bundled);
        }
    }
    let bytes = http_get(PLAYIT_WINDOWS)
        .map_err(|error| format!("Could not download the official playit.gg agent: {error}"))?
        .bytes()
        .map_err(|error| format!("Could not read the playit.gg download: {error}"))?;
    fs::write(&bundled, &bytes).map_err(|error| format!("Could not save playit.gg: {error}"))?;
    Ok(bundled)
}

fn safe_id(value: &str) -> Result<&str, String> {
    if value.len() < 3
        || value.len() > 64
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Invalid server identifier.".into());
    }
    Ok(value)
}

fn set_server_property(path: &Path, key: &str, value: &str) -> Result<(), String> {
    let original = fs::read_to_string(path).unwrap_or_default();
    let prefix = format!("{key}=");
    let mut found = false;
    let mut lines: Vec<String> = original
        .lines()
        .map(|line| {
            if line.starts_with(&prefix) {
                found = true;
                format!("{prefix}{value}")
            } else {
                line.to_owned()
            }
        })
        .collect();
    if !found {
        lines.push(format!("{prefix}{value}"));
    }
    fs::write(path, format!("{}\n", lines.join("\n")))
        .map_err(|error| format!("Could not update server.properties: {error}"))
}

fn property_value(contents: &str, key: &str, fallback: &str) -> String {
    contents
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")))
        .unwrap_or(fallback)
        .trim()
        .to_owned()
}

fn server_port(path: &Path) -> u16 {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| {
            contents
                .lines()
                .find_map(|line| line.strip_prefix("server-port=")?.trim().parse().ok())
        })
        .unwrap_or(25565)
}

fn first_available_port(servers_dir: &Path) -> u16 {
    let used: Vec<u16> = fs::read_dir(servers_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| fs::read_to_string(entry.path().join("server.properties")).ok())
        .filter_map(|contents| {
            contents
                .lines()
                .find_map(|line| line.strip_prefix("server-port=")?.trim().parse().ok())
        })
        .collect();
    (25565..=25665)
        .find(|port| !used.contains(port))
        .unwrap_or(25565)
}

#[tauri::command]
fn system_status(app: AppHandle) -> Result<SystemStatus, String> {
    let java_version = command_output("java", &["-version"]);
    let java_majors = [8, 16, 17, 21, 25]
        .into_iter()
        .filter(|major| {
            runtime::java_candidates(*major).into_iter().any(|path| {
                command_output(&path.to_string_lossy(), &["-version"])
                    .and_then(|output| runtime::java_major(&output))
                    == Some(*major)
            })
        })
        .collect::<Vec<_>>();
    let playit =
        find_playit().or_else(|| bundled_playit_path(&app).ok().filter(|path| path.is_file()));
    let data_directory = app_servers_dir(&app)?.to_string_lossy().into_owned();

    Ok(SystemStatus {
        java_installed: !java_majors.is_empty(),
        java_version,
        java_majors,
        playit_installed: playit.is_some(),
        playit_path: playit.map(|path| path.to_string_lossy().into_owned()),
        playit_configured: configured_playit_secret(&app)?.is_some() || configured_playit_session(&app)?.is_some(),
        playit_account_linked: configured_playit_session(&app)?.is_some(),
        playit_agent_linked: configured_playit_secret(&app)?.is_some(),
        data_directory,
        local_address: local_address(),
    })
}

#[tauri::command]
fn software_versions(software: String) -> Result<Vec<String>, String> {
    if matches!(software.as_str(), "forge" | "neoforge") {
        let metadata = if software == "forge" {
            FORGE_METADATA
        } else {
            NEOFORGE_METADATA
        };
        let xml = http_get(metadata)
            .map_err(|error| format!("The loader version service is unavailable: {error}"))?
            .text()
            .map_err(|error| format!("Could not read loader versions: {error}"))?;
        let mut versions: Vec<String> = xml_versions(&xml)
            .into_iter()
            .filter_map(|loader| {
                if software == "forge" {
                    loader.rsplit_once('-').map(|(game, _)| game.to_owned())
                } else {
                    neoforge_game_version(&loader)
                }
            })
            .collect();
        versions.retain(|version| stable_game_version(version));
        versions.sort_by_key(|version| std::cmp::Reverse(version_numbers(version)));
        versions.dedup();
        versions.truncate(100);
        return Ok(versions);
    }
    let url = match software.as_str() {
        "vanilla" => MOJANG_MANIFEST.to_owned(),
        "paper" => PAPER_API.to_owned(),
        "purpur" => PURPUR_API.to_owned(),
        "fabric" => format!("{FABRIC_META}/versions/game"),
        _ => return Err("Choose a supported server platform.".into()),
    };
    let data: Value = http_get(url)
        .map_err(|error| format!("The version service is unavailable: {error}"))?
        .json()
        .map_err(|error| format!("The version service returned invalid data: {error}"))?;

    let mut versions: Vec<String> = match software.as_str() {
        "vanilla" => data["versions"]
            .as_array()
            .ok_or("Mojang returned no versions.")?
            .iter()
            .filter(|item| item["type"] == "release")
            .filter_map(|item| item["id"].as_str().map(ToOwned::to_owned))
            .collect(),
        "paper" => data["versions"]
            .as_object()
            .ok_or("Paper returned no version groups.")?
            .values()
            .filter_map(Value::as_array)
            .flatten()
            .filter_map(|item| item.as_str().map(ToOwned::to_owned))
            .collect(),
        "purpur" => data["versions"]
            .as_array()
            .ok_or("Purpur returned no versions.")?
            .iter()
            .filter_map(|item| item.as_str().map(ToOwned::to_owned))
            .collect(),
        "fabric" => data
            .as_array()
            .ok_or("Fabric returned no versions.")?
            .iter()
            .filter(|item| item["stable"].as_bool().unwrap_or(false))
            .filter_map(|item| item["version"].as_str().map(ToOwned::to_owned))
            .collect(),
        _ => Vec::new(),
    };
    versions.retain(|version| stable_game_version(version));
    if matches!(software.as_str(), "paper" | "purpur") {
        versions.sort_by_key(|version| std::cmp::Reverse(version_numbers(version)));
    }
    versions.truncate(100);
    Ok(versions)
}

fn version_numbers(version: &str) -> Vec<u32> {
    version
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

fn stable_game_version(version: &str) -> bool {
    !version.contains('-')
        && version.split('.').all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
}

fn xml_versions(xml: &str) -> Vec<String> {
    xml.split("<version>")
        .skip(1)
        .filter_map(|part| part.split("</version>").next())
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn neoforge_game_version(loader: &str) -> Option<String> {
    let mut parts = loader.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next()?.parse().ok()?;
    Some(if major >= 26 {
        format!("{major}.{minor}")
    } else {
        format!("1.{major}.{minor}")
    })
}

#[tauri::command]
fn install_server(
    app: AppHandle,
    id: String,
    software: String,
    game_version: String,
    offline_mode: bool,
) -> Result<InstalledServer, String> {
    safe_id(&id)?;
    if !game_version
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
    {
        return Err("Invalid Minecraft version.".into());
    }

    let (download_url, build_label, needs_installer) = match software.as_str() {
        "fabric" => {
            let entries: Vec<Value> =
                http_get(format!("{FABRIC_META}/versions/loader/{game_version}"))
                    .map_err(|error| format!("Fabric does not support that version: {error}"))?
                    .json()
                    .map_err(|error| format!("Fabric returned invalid metadata: {error}"))?;
            let entry = entries
                .iter()
                .find(|item| item["loader"]["stable"].as_bool().unwrap_or(false))
                .or_else(|| entries.first())
                .ok_or_else(|| "No Fabric loader exists for that version.".to_owned())?;
            let loader = entry["loader"]["version"]
                .as_str()
                .ok_or("Missing Fabric loader version.")?;
            // Fabric metadata v2 stopped embedding an `installer` object in
            // each loader response. Resolve the current official installer
            // separately so Fabric installs keep working as the API evolves.
            let installers: Vec<Value> = http_get(format!("{FABRIC_META}/versions/installer"))
                .map_err(|error| format!("Could not load the Fabric installer: {error}"))?
                .json()
                .map_err(|error| format!("Fabric returned invalid installer metadata: {error}"))?;
            let installer = installers
                .iter()
                .find(|item| item["stable"].as_bool().unwrap_or(false))
                .or_else(|| installers.first())
                .and_then(|item| item["version"].as_str())
                .ok_or("Missing Fabric installer version.")?;
            (
                format!(
                    "{FABRIC_META}/versions/loader/{game_version}/{loader}/{installer}/server/jar"
                ),
                format!("Loader {loader}"),
                false,
            )
        }
        "paper" => {
            let builds: Vec<Value> =
                http_get(format!("{PAPER_API}/versions/{game_version}/builds"))
                    .map_err(|error| format!("Paper does not support that version: {error}"))?
                    .json()
                    .map_err(|error| format!("Paper returned invalid build data: {error}"))?;
            let build = builds
                .iter()
                .find(|item| item["channel"] == "STABLE")
                .or_else(|| builds.first())
                .ok_or_else(|| "Paper has no build for that version.".to_owned())?;
            let build_id = build["id"]
                .as_u64()
                .ok_or("Paper build number is missing.")?;
            let url = build["downloads"]["server:default"]["url"]
                .as_str()
                .ok_or("Paper download URL is missing.")?;
            (url.to_owned(), format!("Build {build_id}"), false)
        }
        "purpur" => {
            let data: Value = http_get(format!("{PURPUR_API}/{game_version}"))
                .map_err(|error| format!("Purpur does not support that version: {error}"))?
                .json()
                .map_err(|error| format!("Purpur returned invalid build data: {error}"))?;
            let build = match &data["builds"]["latest"] {
                Value::String(value) => value.clone(),
                Value::Number(value) => value.to_string(),
                _ => return Err("Purpur returned no latest build.".into()),
            };
            (
                format!("{PURPUR_API}/{game_version}/{build}/download"),
                format!("Build {build}"),
                false,
            )
        }
        "forge" | "neoforge" => {
            let metadata_url = if software == "forge" {
                FORGE_METADATA
            } else {
                NEOFORGE_METADATA
            };
            let xml = http_get(metadata_url)
                .map_err(|error| format!("Could not load {software} releases: {error}"))?
                .text()
                .map_err(|error| format!("Could not read {software} releases: {error}"))?;
            let loader = xml_versions(&xml)
                .into_iter()
                .filter(|version| {
                    if software == "forge" {
                        version.starts_with(&format!("{game_version}-"))
                    } else {
                        neoforge_game_version(version).as_deref() == Some(game_version.as_str())
                    }
                })
                .max_by(|a, b| version_numbers(a).cmp(&version_numbers(b)))
                .ok_or_else(|| {
                    format!("No {software} installer exists for Minecraft {game_version}.")
                })?;
            let url = if software == "forge" {
                format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{loader}/forge-{loader}-installer.jar")
            } else {
                format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{loader}/neoforge-{loader}-installer.jar")
            };
            (url, format!("Loader {loader}"), true)
        }
        "vanilla" => {
            let manifest: Value = http_get(MOJANG_MANIFEST)
                .map_err(|error| format!("Could not load Mojang versions: {error}"))?
                .json()
                .map_err(|error| format!("Mojang returned invalid metadata: {error}"))?;
            let metadata_url = manifest["versions"]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["id"] == game_version))
                .and_then(|item| item["url"].as_str())
                .ok_or("That official Minecraft version was not found.")?;
            let metadata: Value = http_get(metadata_url)
                .map_err(|error| format!("Could not load Mojang download data: {error}"))?
                .json()
                .map_err(|error| format!("Mojang returned invalid download data: {error}"))?;
            let url = metadata["downloads"]["server"]["url"]
                .as_str()
                .ok_or("Mojang does not publish a server for that version.")?;
            (url.to_owned(), "Official".to_owned(), false)
        }
        _ => return Err("Choose a supported server platform.".into()),
    };

    let bytes = http_get(download_url)
        .map_err(|error| format!("Could not download the server: {error}"))?
        .bytes()
        .map_err(|error| format!("Could not read the server download: {error}"))?;

    let servers_directory = app_servers_dir(&app)?;
    let directory = servers_directory.join(&id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the server directory: {error}"))?;
    let download_path = directory.join(if needs_installer {
        "installer.jar"
    } else {
        "server.jar"
    });
    fs::write(&download_path, &bytes)
        .map_err(|error| format!("Could not save the server: {error}"))?;
    let launch_path = if needs_installer {
        let mut installer = Command::new(java_for_game(&game_version)?);
        hidden(&mut installer);
        let status = installer
            .current_dir(&directory)
            .args(["-jar", "installer.jar", "--installServer"])
            .status()
            .map_err(|error| format!("Could not run the {software} installer: {error}"))?;
        if !status.success() {
            return Err(format!("The {software} installer exited with {status}."));
        }
        let script = if cfg!(windows) {
            directory.join("run.bat")
        } else {
            directory.join("run.sh")
        };
        if !script.is_file() {
            return Err(format!(
                "The {software} installer did not create its launch script."
            ));
        }
        let _ = fs::remove_file(&download_path);
        script
    } else {
        download_path
    };
    fs::write(directory.join("eula.txt"), "eula=true\n")
        .map_err(|error| format!("Could not accept the Minecraft EULA: {error}"))?;
    set_server_property(
        &directory.join("server.properties"),
        "online-mode",
        if offline_mode { "false" } else { "true" },
    )?;
    set_server_property(
        &directory.join("server.properties"),
        "server-port",
        &first_available_port(&servers_directory).to_string(),
    )?;

    Ok(InstalledServer {
        id,
        jar_path: launch_path.to_string_lossy().into_owned(),
        software,
        game_version,
        loader_version: build_label,
        offline_mode,
    })
}

#[tauri::command]
fn set_offline_mode(app: AppHandle, id: String, offline_mode: bool) -> Result<(), String> {
    safe_id(&id)?;
    let properties = app_servers_dir(&app)?.join(&id).join("server.properties");
    set_server_property(
        &properties,
        "online-mode",
        if offline_mode { "false" } else { "true" },
    )
}

#[tauri::command]
fn server_settings(app: AppHandle, id: String) -> Result<ServerSettings, String> {
    safe_id(&id)?;
    let contents = fs::read_to_string(app_servers_dir(&app)?.join(&id).join("server.properties"))
        .map_err(|error| format!("Could not read server.properties: {error}"))?;
    let keep_inventory = fs::read_to_string(
        app_servers_dir(&app)?
            .join(&id)
            .join(".crewship-settings.json"),
    )
    .ok()
    .and_then(|value| serde_json::from_str::<Value>(&value).ok())
    .and_then(|value| value.get("keepInventory").and_then(Value::as_bool))
    .unwrap_or(false);
    Ok(ServerSettings {
        max_players: property_value(&contents, "max-players", "20")
            .parse()
            .unwrap_or(20),
        gamemode: property_value(&contents, "gamemode", "survival"),
        difficulty: property_value(&contents, "difficulty", "easy"),
        white_list: property_value(&contents, "white-list", "false") == "true",
        allow_flight: property_value(&contents, "allow-flight", "false") == "true",
        force_gamemode: property_value(&contents, "force-gamemode", "false") == "true",
        spawn_protection: property_value(&contents, "spawn-protection", "16")
            .parse()
            .unwrap_or(16),
        require_resource_pack: property_value(&contents, "require-resource-pack", "false")
            == "true",
        resource_pack: property_value(&contents, "resource-pack", ""),
        resource_pack_prompt: property_value(&contents, "resource-pack-prompt", ""),
        keep_inventory,
    })
}

#[tauri::command]
fn save_server_settings(
    app: AppHandle,
    id: String,
    settings: ServerSettings,
) -> Result<(), String> {
    safe_id(&id)?;
    if settings.max_players == 0 || settings.max_players > 500 {
        return Err("Player slots must be between 1 and 500.".into());
    }
    if settings.spawn_protection > 128 {
        return Err("Spawn protection must be between 0 and 128.".into());
    }
    if !matches!(
        settings.gamemode.as_str(),
        "survival" | "creative" | "adventure" | "spectator"
    ) {
        return Err("Choose a valid game mode.".into());
    }
    if !matches!(
        settings.difficulty.as_str(),
        "peaceful" | "easy" | "normal" | "hard"
    ) {
        return Err("Choose a valid difficulty.".into());
    }
    let path = app_servers_dir(&app)?.join(&id).join("server.properties");
    for (key, value) in [
        ("max-players", settings.max_players.to_string()),
        ("gamemode", settings.gamemode),
        ("difficulty", settings.difficulty),
        ("white-list", settings.white_list.to_string()),
        ("allow-flight", settings.allow_flight.to_string()),
        ("force-gamemode", settings.force_gamemode.to_string()),
        ("spawn-protection", settings.spawn_protection.to_string()),
        (
            "require-resource-pack",
            settings.require_resource_pack.to_string(),
        ),
        ("resource-pack", settings.resource_pack),
        ("resource-pack-prompt", settings.resource_pack_prompt),
    ] {
        set_server_property(&path, key, &value)?;
    }
    let sidecar = app_servers_dir(&app)?
        .join(&id)
        .join(".crewship-settings.json");
    fs::write(
        sidecar,
        serde_json::json!({ "keepInventory": settings.keep_inventory }).to_string(),
    )
    .map_err(|error| format!("Could not save Crew.Ship settings: {error}"))?;
    Ok(())
}

#[tauri::command]
fn send_server_command(
    id: String,
    command: String,
    state: State<'_, HostState>,
) -> Result<(), String> {
    safe_id(&id)?;
    let mut servers = state
        .servers
        .lock()
        .map_err(|_| "The local server manager is unavailable.".to_owned())?;
    let managed = servers
        .get_mut(&id)
        .ok_or("Start this server before sending commands.")?;
    if managed
        .child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Err("This server is not running.".into());
    }
    let stdin = managed
        .stdin
        .as_mut()
        .ok_or("The server console is unavailable.")?;
    stdin
        .write_all(command.trim().as_bytes())
        .map_err(|error| error.to_string())?;
    stdin.write_all(b"\n").map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn server_address(app: AppHandle, id: String) -> Result<ServerAddress, String> {
    safe_id(&id)?;
    let properties = app_servers_dir(&app)?.join(&id).join("server.properties");
    let port = server_port(&properties);
    Ok(ServerAddress {
        lan_address: local_ip().map(|address| format!("{address}:{port}")),
        public_address: fs::read_to_string(properties.with_file_name(".crewship-public-address"))
            .ok()
            .and_then(|v| runtime::public_address(&v).ok())
            .filter(|v| !v.is_empty()),
        port,
        playit_configured: configured_playit_secret(&app)?.is_some(),
    })
}

#[tauri::command]
fn save_public_address(app: AppHandle, id: String, address: String) -> Result<(), String> {
    safe_id(&id)?;
    let address = runtime::public_address(&address)?;
    let directory = app_servers_dir(&app)?.join(id);
    if !directory.is_dir() {
        return Err("Server folder is missing.".into());
    }
    fs::write(directory.join(".crewship-public-address"), address).map_err(|e| e.to_string())
}

fn read_log_stream<R: std::io::Read + Send + 'static>(
    reader: R,
    logs: Arc<Mutex<VecDeque<String>>>,
    ready: Arc<std::sync::atomic::AtomicBool>,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if runtime::ready_line(&line) {
                ready.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            if let Ok(mut buffer) = logs.lock() {
                if buffer.len() >= 1_000 {
                    buffer.pop_front();
                }
                buffer.push_back(line);
            }
        }
    });
}

/// Forge and NeoForge generate `run.bat` with a final `pause`. That is useful
/// when somebody double-clicks it, but it leaves a hidden desktop host stuck
/// after Minecraft stops. Run the loader's own generated argument file instead.
#[cfg(windows)]
fn loader_argument_file(directory: &Path, script_name: &str) -> Option<String> {
    let script = fs::read_to_string(directory.join(script_name)).ok()?;
    script.split_whitespace().find_map(|token| {
        let token = token.trim_matches('"');
        let argument_file = token.strip_prefix('@')?;
        if !argument_file.ends_with("_args.txt") || !argument_file.contains("libraries/") {
            return None;
        }
        let file = directory.join(argument_file.replace('/', "\\"));
        file.is_file().then(|| format!("@{argument_file}"))
    })
}

#[tauri::command]
fn start_server(
    config: StartConfig,
    app: AppHandle,
    state: State<'_, HostState>,
) -> Result<ProcessStatus, String> {
    safe_id(&config.id)?;
    if !(1_024..=65_536).contains(&config.memory_mb) {
        return Err("Memory must be between 1024 MB and 65536 MB.".into());
    }

    let launch_path = Path::new(&config.jar_path)
        .canonicalize()
        .map_err(|_| "The server file is missing. Reinstall this server.".to_owned())?;
    let launch_path = runtime::process_path(&launch_path);
    let directory = launch_path
        .parent()
        .ok_or_else(|| "The server folder is invalid.".to_owned())?;
    // Crew.Ship defaults to compatible login mode so both premium and offline
    // clients can join. Hosts should use a whitelist/auth plugin for identity.
    set_server_property(&directory.join("server.properties"), "online-mode", "false")?;

    let mut servers = state
        .servers
        .lock()
        .map_err(|_| "The local server manager is unavailable.".to_owned())?;
    if let Some(existing) = servers.get_mut(&config.id) {
        if existing
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            if existing.stopping {
                return Err("The server is still stopping. Wait for it to finish saving.".into());
            }
            return Ok(ProcessStatus {
                running: true,
                ready: existing.ready.load(std::sync::atomic::Ordering::Relaxed),
                exit_code: None,
            });
        }
        servers.remove(&config.id);
    }

    // Once an agent secret has been connected, keep the bundled Playit agent
    // running automatically whenever one of this computer's servers starts.
    if configured_playit_secret(&app)?.is_some() {
        let _ = start_playit_process(&app, None, &state);
    }
    // A Third Party App connection lets Crew.Ship create the matching
    // Minecraft Java tunnel itself. Keep this best-effort so a temporary
    // Playit outage never prevents the local server from starting.
    if let Ok(Some(address)) = provision_playit_tunnel(
        &app,
        &config.id,
        &config.software,
        server_port(&directory.join("server.properties")),
    ) {
        let _ = fs::write(directory.join(".crewship-public-address"), address);
    }
    let java_path = install_java_for_game(&config.game_version)?;
    let installer_platform = matches!(config.software.as_str(), "forge" | "neoforge");
    let mut command = if installer_platform {
        fs::write(
            directory.join("user_jvm_args.txt"),
            format!(
                "-Xms{}M\n-Xmx{}M\n",
                config.memory_mb.min(1_024),
                config.memory_mb
            ),
        )
        .map_err(|error| format!("Could not configure server memory: {error}"))?;
        #[cfg(windows)]
        {
            if let Some(arguments) = loader_argument_file(directory, "run.bat") {
                let mut java = Command::new(&java_path);
                java.args(["@user_jvm_args.txt", &arguments, "nogui"]);
                java
            } else {
                // `canonicalize` returns an extended-length `\\?\C:\...` path on
                // Windows. Java accepts that form, but cmd.exe does not treat it as
                // an executable batch-file name. Pass the ordinary path to cmd.
                let native_path = launch_path.to_string_lossy();
                let display_path = native_path
                    .strip_prefix(r"\\?\")
                    .unwrap_or(native_path.as_ref())
                    .to_owned();
                if !Path::new(&display_path).is_file() {
                    return Err(format!(
                        "The {} launch script is missing. Reinstall this server.",
                        config.software
                    ));
                }
                let mut script = Command::new("cmd.exe");
                // Give cmd each token separately. Letting Rust quote the path avoids
                // the literal `\\\"C:\\...` command seen in older builds when the
                // Crew.Ship data folder contains spaces.
                script
                    .arg("/D")
                    .arg("/C")
                    .arg("call")
                    .arg(display_path)
                    .arg("nogui");
                script
            }
        }
        #[cfg(not(windows))]
        {
            let mut script = Command::new("sh");
            script.args([launch_path.to_string_lossy().as_ref(), "nogui"]);
            script
        }
    } else {
        let mut java = Command::new(&java_path);
        java.arg(format!("-Xms{}M", config.memory_mb.min(1_024)))
            .arg(format!("-Xmx{}M", config.memory_mb))
            .args(["-jar", launch_path.to_string_lossy().as_ref(), "nogui"]);
        java
    };
    hidden(&mut command);
    if let Some(bin) = java_path.parent() {
        let mut paths = vec![bin.to_path_buf()];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        if let Ok(path) = std::env::join_paths(paths) {
            command.env("PATH", path);
        }
        if let Some(home) = bin.parent() {
            command.env("JAVA_HOME", home);
        }
    }
    command
        .current_dir(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        format!("Minecraft could not start. Check that Java is installed: {error}")
    })?;
    let stdin = child.stdin.take();
    let logs = Arc::new(Mutex::new(VecDeque::from([
        "[Crew.Ship] Starting Minecraft in the background…".to_owned(),
    ])));
    let ready = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Some(stdout) = child.stdout.take() {
        read_log_stream(stdout, Arc::clone(&logs), Arc::clone(&ready));
    }
    if let Some(stderr) = child.stderr.take() {
        read_log_stream(stderr, Arc::clone(&logs), Arc::clone(&ready));
    }

    let keep_inventory = fs::read_to_string(directory.join(".crewship-settings.json"))
        .ok()
        .and_then(|value| serde_json::from_str::<Value>(&value).ok())
        .and_then(|value| value.get("keepInventory").and_then(Value::as_bool))
        .unwrap_or(false);
    servers.insert(
        config.id.clone(),
        ManagedServer {
            child,
            stdin,
            logs: Arc::clone(&logs),
            ready: Arc::clone(&ready),
            stopping: false,
        },
    );
    // Let launchers report an immediate configuration or Java failure instead
    // of claiming the world is running. The console remains available in either
    // case, so users can see the real loader error.
    thread::sleep(Duration::from_millis(700));
    let managed = servers
        .get_mut(&config.id)
        .ok_or("Server state disappeared.")?;
    let exit_status = managed
        .child
        .try_wait()
        .map_err(|error| error.to_string())?;
    let running = exit_status.is_none();
    let exit_code = exit_status.and_then(|status| status.code());
    if running {
        if let Some(stdin) = managed.stdin.as_mut() {
            let _ =
                stdin.write_all(format!("gamerule keepInventory {keep_inventory}\n").as_bytes());
            let _ = stdin.flush();
        }
    }
    Ok(ProcessStatus {
        running,
        ready: running && ready.load(std::sync::atomic::Ordering::Relaxed),
        exit_code,
    })
}

#[tauri::command]
fn delete_server(app: AppHandle, id: String, state: State<'_, HostState>) -> Result<(), String> {
    safe_id(&id)?;
    if let Some(mut managed) = state
        .servers
        .lock()
        .map_err(|_| "State lock failed.")?
        .remove(&id)
    {
        if let Some(mut stdin) = managed.stdin.take() {
            let _ = stdin.write_all(b"stop\n");
            let _ = stdin.flush();
        }
        thread::sleep(Duration::from_millis(250));
        if managed
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            let _ = managed.child.kill();
            let _ = managed.child.wait();
        }
    }
    let target = app_servers_dir(&app)?.join(&id);
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("Could not remove this server's files: {error}"))?;
    }
    Ok(())
}

fn server_is_running(id: &str, state: &HostState) -> Result<bool, String> {
    let mut servers = state
        .servers
        .lock()
        .map_err(|_| "State lock failed.".to_owned())?;
    let Some(server) = servers.get_mut(id) else {
        return Ok(false);
    };
    Ok(server
        .child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none())
}

#[tauri::command]
fn list_backups(app: AppHandle, id: String) -> Result<Vec<BackupItem>, String> {
    safe_id(&id)?;
    let directory = app_backups_dir(&app, &id)?;
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    let mut backups = fs::read_dir(&directory)
        .map_err(|error| format!("Could not read backups: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("zip") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let created_at = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_secs();
            let name = path.file_name()?.to_str()?.to_owned();
            Some(BackupItem {
                id: name.trim_end_matches(".zip").to_owned(),
                name,
                path: path.to_string_lossy().into_owned(),
                size_bytes: metadata.len(),
                created_at,
            })
        })
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

#[tauri::command]
fn create_backup(
    app: AppHandle,
    id: String,
    state: State<'_, HostState>,
) -> Result<BackupItem, String> {
    safe_id(&id)?;
    if server_is_running(&id, &state)? {
        return Err(
            "Stop the server and wait for it to finish saving before creating a backup.".into(),
        );
    }
    let source = app_servers_dir(&app)?.join(&id);
    if !source.is_dir() {
        return Err("Server folder is missing.".into());
    }
    let directory = app_backups_dir(&app, &id)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create backup storage: {error}"))?;
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let backup_id = format!("{id}-{created_at}");
    let filename = format!("{backup_id}.zip");
    let destination = directory.join(&filename);
    let temporary = directory.join(format!("{backup_id}.partial.zip"));
    let mut command = Command::new("tar.exe");
    hidden(&mut command);
    let status = command
        .args(["-a", "-c", "-f"])
        .arg(&temporary)
        .args(["-C"])
        .arg(&source)
        .arg(".")
        .status()
        .map_err(|error| format!("Could not start Windows backup tool: {error}"))?;
    if !status.success() || !temporary.is_file() {
        let _ = fs::remove_file(&temporary);
        return Err("Windows could not create the backup zip. Make sure tar.exe is available and try again.".into());
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Could not finish the backup: {error}"))?;
    let size_bytes = fs::metadata(&destination)
        .map_err(|error| error.to_string())?
        .len();
    Ok(BackupItem {
        id: backup_id,
        name: filename,
        path: destination.to_string_lossy().into_owned(),
        size_bytes,
        created_at,
    })
}

#[tauri::command]
fn backups_directory(app: AppHandle, id: String) -> Result<String, String> {
    safe_id(&id)?;
    let directory = app_backups_dir(&app, &id)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create backup storage: {error}"))?;
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn server_mods_directory(app: AppHandle, id: String) -> Result<String, String> {
    safe_id(&id)?;
    let directory = app_servers_dir(&app)?.join(&id).join("mods");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the mods folder: {error}"))?;
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn search_modrinth(query: String, kind: String) -> Result<Vec<AddonResult>, String> {
    let project_type = match kind.as_str() {
        "mod" => "mod",
        "plugin" => "plugin",
        _ => return Err("Choose mods or plugins.".into()),
    };
    let facets = serde_json::to_string(&vec![vec![format!("project_type:{project_type}")]])
        .map_err(|error| error.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("Crew.Ship/0.5 (https://github.com/VirtualFox3/Crew.Ship)")
        .build()
        .map_err(|error| format!("Could not create the catalog client: {error}"))?;
    let response: ModrinthSearchResponse = client
        .get("https://api.modrinth.com/v2/search")
        .query(&[
            ("query", query.as_str()),
            ("facets", facets.as_str()),
            ("limit", "24"),
        ])
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("Modrinth search failed: {error}"))?
        .json()
        .map_err(|error| format!("Modrinth returned an invalid response: {error}"))?;
    Ok(response
        .hits
        .into_iter()
        .map(|hit| AddonResult {
            id: hit.project_id,
            title: hit.title,
            description: hit.description,
            icon_url: hit.icon_url,
            downloads: hit.downloads,
        })
        .collect())
}

#[tauri::command]
fn install_modrinth_addon(
    app: AppHandle,
    server_id: String,
    project_id: String,
    kind: String,
    game_version: String,
    loader: String,
) -> Result<InstalledAddon, String> {
    let server_id = safe_id(&server_id)?;
    let directory_name = match kind.as_str() {
        "mod" if matches!(loader.as_str(), "fabric" | "forge" | "neoforge") => "mods",
        "plugin" if matches!(loader.as_str(), "paper" | "purpur") => "plugins",
        "mod" => return Err("Mods require Fabric, Forge, or NeoForge.".into()),
        "plugin" => return Err("Plugins require Paper or Purpur.".into()),
        _ => return Err("Choose mods or plugins.".into()),
    };
    if project_id.is_empty()
        || !project_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err("Invalid Modrinth project identifier.".into());
    }
    let loader_filters = if loader == "purpur" {
        vec!["purpur", "paper"]
    } else {
        vec![loader.as_str()]
    };
    let loaders = serde_json::to_string(&loader_filters).map_err(|error| error.to_string())?;
    let game_versions =
        serde_json::to_string(&vec![game_version.clone()]).map_err(|error| error.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("Crew.Ship/0.5 (https://github.com/VirtualFox3/Crew.Ship)")
        .build()
        .map_err(|error| format!("Could not create the catalog client: {error}"))?;
    // Resolve required dependencies before writing anything. A successful
    // button press should not leave a server with only half a modpack.
    let mut pending = vec![project_id];
    let mut visited = HashSet::new();
    let mut resolved = Vec::<(String, String, String)>::new();
    while let Some(project) = pending.pop() {
        if !visited.insert(project.clone()) {
            continue;
        }
        if visited.len() > 40 {
            return Err("This add-on has too many required dependencies to install safely.".into());
        }
        let versions: Vec<ModrinthVersion> = client
            .get(format!(
                "https://api.modrinth.com/v2/project/{project}/version"
            ))
            .query(&[
                ("loaders", loaders.as_str()),
                ("game_versions", game_versions.as_str()),
            ])
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("Could not resolve a compatible Modrinth release: {error}"))?
            .json()
            .map_err(|error| format!("Modrinth returned an invalid release: {error}"))?;
        let version = versions.into_iter().next().ok_or_else(|| {
            format!("No compatible release exists for required project {project} on Minecraft {game_version} and {loader}.")
        })?;
        let file = version
            .files
            .iter()
            .find(|file| file.primary.unwrap_or(false))
            .or_else(|| version.files.first())
            .ok_or_else(|| "The selected release has no downloadable file.".to_string())?;
        let safe_filename = Path::new(&file.filename)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| name.ends_with(".jar"))
            .ok_or_else(|| "Modrinth returned an unsafe or unsupported filename.".to_string())?;
        for dependency in &version.dependencies {
            if dependency.dependency_type == "required" {
                let dependency_project = dependency.project_id.clone().ok_or_else(|| {
                    format!("{} has a required dependency that Modrinth cannot resolve automatically. Install it manually before retrying.", version.name)
                })?;
                pending.push(dependency_project);
            }
        }
        resolved.push((version.name, safe_filename.to_owned(), file.url.clone()));
    }
    let directory = app_servers_dir(&app)?.join(server_id).join(directory_name);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the add-on directory: {error}"))?;
    let root_name = resolved
        .first()
        .map(|(name, _, _)| name.clone())
        .ok_or("No add-on was resolved.")?;
    let root_filename = resolved
        .first()
        .map(|(_, filename, _)| filename.clone())
        .ok_or("No add-on was resolved.")?;
    for (_, filename, url) in &resolved {
        let bytes = http_get(url)?
            .bytes()
            .map_err(|error| format!("Could not download the add-on: {error}"))?;
        fs::write(directory.join(filename), &bytes)
            .map_err(|error| format!("Could not install the add-on: {error}"))?;
    }
    Ok(InstalledAddon {
        name: root_name,
        filename: root_filename,
        directory: directory.to_string_lossy().into_owned(),
        installed_files: resolved.len() as u32,
    })
}

#[tauri::command]
fn server_status(id: String, state: State<'_, HostState>) -> Result<ProcessStatus, String> {
    let mut servers = state.servers.lock().map_err(|_| "State lock failed.")?;
    let Some(server) = servers.get_mut(&id) else {
        return Ok(ProcessStatus {
            running: false,
            ready: false,
            exit_code: None,
        });
    };
    let exit = server.child.try_wait().map_err(|error| error.to_string())?;
    Ok(ProcessStatus {
        running: exit.is_none(),
        ready: exit.is_none()
            && !server.stopping
            && server.ready.load(std::sync::atomic::Ordering::Relaxed),
        exit_code: exit.and_then(|status| status.code()),
    })
}

#[tauri::command]
fn server_logs(id: String, state: State<'_, HostState>) -> Result<Vec<String>, String> {
    let servers = state.servers.lock().map_err(|_| "State lock failed.")?;
    let Some(server) = servers.get(&id) else {
        return Ok(Vec::new());
    };
    let lines = server.logs.lock().map_err(|_| "Log lock failed.")?;
    Ok(lines.iter().cloned().collect())
}

#[tauri::command]
async fn stop_server(id: String, app: AppHandle) -> Result<ProcessStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<HostState>();
        for attempt in 0..120 {
            {
                let mut servers = state.servers.lock().map_err(|_| "State lock failed.")?;
                let Some(server) = servers.get_mut(&id) else {
                    return Ok(ProcessStatus { running: false, ready: false, exit_code: None });
                };
                if let Some(exit) = server.child.try_wait().map_err(|e| e.to_string())? {
                    return Ok(ProcessStatus { running: false, ready: false, exit_code: exit.code() });
                }
                if attempt == 0 && !server.stopping {
                    let stdin = server.stdin.as_mut().ok_or("The server console is unavailable; no forced stop was performed.")?;
                    stdin.write_all(b"stop\n").and_then(|_| stdin.flush()).map_err(|e| e.to_string())?;
                    server.stopping = true;
                }
            }
            thread::sleep(Duration::from_millis(500));
        }
        Err("The server is still saving after 60 seconds. It has NOT been force-killed. Check Console and wait before retrying.".into())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn start_playit(
    app: AppHandle,
    path: Option<String>,
    state: State<'_, HostState>,
) -> Result<bool, String> {
    start_playit_process(&app, path, &state)
}

fn start_playit_process(
    app: &AppHandle,
    path: Option<String>,
    state: &HostState,
) -> Result<bool, String> {
    let executable = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(find_playit)
        .map(Ok)
        .unwrap_or_else(|| ensure_playit(app))?;
    if !executable.is_file() {
        return Err("The selected playit.gg executable does not exist.".into());
    }
    let secret_path = configured_playit_secret(app)?.ok_or("Playit needs an agent secret before it can connect. In Playit, create or select an agent on this computer, copy its agent secret, then paste it in Crew.Ship Host settings. Your Playit password is never needed here.")?;

    let mut playit = state.playit.lock().map_err(|_| "State lock failed.")?;
    if let Some(process) = playit.as_mut() {
        if process
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(true);
        }
    }
    let mut command = Command::new(executable);
    hidden(&mut command);
    command.args([
        "--secret-path",
        secret_path.to_string_lossy().as_ref(),
        "--log-path",
        playit_log_path(app)?.to_string_lossy().as_ref(),
    ]);
    *playit = Some(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("playit.gg could not start: {error}"))?,
    );
    Ok(true)
}

#[tauri::command]
fn configure_playit(
    app: AppHandle,
    secret: String,
    state: State<'_, HostState>,
) -> Result<(), String> {
    let secret = secret.trim();
    if !playit_secret_is_valid(secret) {
        return Err("That does not look like a Playit agent secret. Paste the hexadecimal agent secret from Playit, not your Playit password or public server address.".into());
    }
    if let Some(mut process) = state
        .playit
        .lock()
        .map_err(|_| "State lock failed.")?
        .take()
    {
        let _ = process.kill();
        let _ = process.wait();
    }
    let path = playit_secret_path(&app)?;
    fs::write(&path, format!("secret_key = \"{secret}\"\n"))
        .map_err(|error| format!("Could not save the local Playit agent secret: {error}"))
}

/// Accept the short-lived code from Playit's “Third Party App” browser flow.
/// The returned session is saved only in Crew.Ship's local app-data folder.
#[tauri::command]
fn configure_playit_setup_code(app: AppHandle, code: String) -> Result<(), String> {
    let code = code.trim();
    if code.len() < 8 || code.len() > 512 {
        return Err("Paste the one-time setup code shown by Playit, not your password or public address.".into());
    }
    let response = playit_api("/login/apply", None, serde_json::json!({ "token": code }))?;
    let session_key = response
        .get("session_key")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("Playit did not return an account session. Generate a fresh setup code and try again.")?;
    let path = playit_session_path(&app)?;
    fs::write(&path, serde_json::json!({ "session_key": session_key }).to_string())
        .map_err(|error| format!("Could not save the local Playit connection: {error}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayitClaim {
    code: String,
    url: String,
}

/// Start the local-agent approval flow. This is intentionally separate from
/// account authorization: the first gives Crew.Ship permission to manage
/// tunnels, while this gives the official agent permission to run here.
#[tauri::command]
fn begin_playit_agent_claim() -> PlayitClaim {
    let code = claim_code();
    PlayitClaim {
        url: format!("https://playit.gg/claim/{code}"),
        code,
    }
}

#[tauri::command]
fn finish_playit_agent_claim(
    app: AppHandle,
    code: String,
    state: State<'_, HostState>,
) -> Result<bool, String> {
    let code = code.trim();
    if code.len() != 10 || !code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("That Crew.Ship agent link has expired. Start a new link and approve it in Playit.".into());
    }
    let setup = playit_api(
        "/claim/setup",
        None,
        serde_json::json!({ "code": code, "agent_type": "self-managed", "version": "Crew.Ship" }),
    )?;
    let status = setup.as_str().unwrap_or_default();
    if status != "UserAccepted" {
        return Err(match status {
            "UserRejected" => "Playit rejected this local agent link. Start a new link if that was a mistake.".into(),
            _ => "Approve the Crew.Ship agent in the Playit browser tab, then select CHECK APPROVAL again.".into(),
        });
    }
    let exchange = playit_api("/claim/exchange", None, serde_json::json!({ "code": code }))?;
    let secret = exchange
        .get("secret_key")
        .and_then(Value::as_str)
        .filter(|value| playit_secret_is_valid(value))
        .ok_or("Playit did not return a valid local-agent key. Start a new link and try again.")?;
    configure_playit(app.clone(), secret.to_owned(), state)?;
    start_playit_process(&app, None, &app.state::<HostState>())
}

#[tauri::command]
fn disconnect_playit(app: AppHandle, state: State<'_, HostState>) -> Result<(), String> {
    if let Some(mut process) = state
        .playit
        .lock()
        .map_err(|_| "State lock failed.")?
        .take()
    {
        let _ = process.kill();
        let _ = process.wait();
    }
    let secret_path = playit_secret_path(&app)?;
    if secret_path.exists() {
        fs::remove_file(secret_path)
            .map_err(|error| format!("Could not remove the local Playit secret: {error}"))?;
    }
    let session_path = playit_session_path(&app)?;
    if session_path.exists() {
        fs::remove_file(session_path)
            .map_err(|error| format!("Could not remove the local Playit connection: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn stop_playit(state: State<'_, HostState>) -> Result<bool, String> {
    if let Some(mut process) = state
        .playit
        .lock()
        .map_err(|_| "State lock failed.")?
        .take()
    {
        let _ = process.kill();
        let _ = process.wait();
    }
    Ok(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .manage(HostState::default())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|_app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_status,
            software_versions,
            install_server,
            set_offline_mode,
            server_settings,
            save_server_settings,
            server_address,
            save_public_address,
            list_backups,
            create_backup,
            backups_directory,
            start_server,
            stop_server,
            send_server_command,
            delete_server,
            server_status,
            server_logs,
            server_mods_directory,
            search_modrinth,
            install_modrinth_addon,
            start_playit,
            configure_playit,
            configure_playit_setup_code,
            begin_playit_agent_claim,
            finish_playit_agent_claim,
            disconnect_playit,
            stop_playit
        ])
        .run(tauri::generate_context!())
        .expect("error while running Crew.Ship");
}
