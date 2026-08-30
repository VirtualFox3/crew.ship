use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
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

#[derive(Default)]
struct HostState {
    servers: Mutex<HashMap<String, ManagedServer>>,
    playit: Mutex<Option<Child>>,
}

struct ManagedServer {
    child: Child,
    stdin: Option<ChildStdin>,
    logs: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemStatus {
    java_installed: bool,
    java_version: Option<String>,
    playit_installed: bool,
    playit_path: Option<String>,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessStatus {
    running: bool,
    exit_code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerAddress {
    lan_address: Option<String>,
    port: u16,
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
}

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
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
        .user_agent("Crew.Ship/0.4 (https://github.com/VirtualFox3/Pack.Host)")
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

fn server_port(path: &Path) -> u16 {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| contents.lines().find_map(|line| line.strip_prefix("server-port=")?.trim().parse().ok()))
        .unwrap_or(25565)
}

fn first_available_port(servers_dir: &Path) -> u16 {
    let used: Vec<u16> = fs::read_dir(servers_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| fs::read_to_string(entry.path().join("server.properties")).ok())
        .filter_map(|contents| contents.lines().find_map(|line| line.strip_prefix("server-port=")?.trim().parse().ok()))
        .collect();
    (25565..=25665).find(|port| !used.contains(port)).unwrap_or(25565)
}

#[tauri::command]
fn system_status(app: AppHandle) -> Result<SystemStatus, String> {
    let java_version = command_output("java", &["-version"]);
    let playit =
        find_playit().or_else(|| bundled_playit_path(&app).ok().filter(|path| path.is_file()));
    let data_directory = app_servers_dir(&app)?.to_string_lossy().into_owned();

    Ok(SystemStatus {
        java_installed: java_version.is_some(),
        java_version,
        playit_installed: playit.is_some(),
        playit_path: playit.map(|path| path.to_string_lossy().into_owned()),
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
        let mut installer = Command::new("java");
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
fn server_address(app: AppHandle, id: String) -> Result<ServerAddress, String> {
    safe_id(&id)?;
    let properties = app_servers_dir(&app)?.join(&id).join("server.properties");
    let port = server_port(&properties);
    Ok(ServerAddress {
        lan_address: local_ip().map(|address| format!("{address}:{port}")),
        port,
    })
}

fn read_log_stream<R: std::io::Read + Send + 'static>(
    reader: R,
    logs: Arc<Mutex<VecDeque<String>>>,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Ok(mut buffer) = logs.lock() {
                if buffer.len() >= 1_000 {
                    buffer.pop_front();
                }
                buffer.push_back(line);
            }
        }
    });
}

#[tauri::command]
fn start_server(config: StartConfig, state: State<'_, HostState>) -> Result<ProcessStatus, String> {
    safe_id(&config.id)?;
    if !(1_024..=65_536).contains(&config.memory_mb) {
        return Err("Memory must be between 1024 MB and 65536 MB.".into());
    }

    let launch_path = Path::new(&config.jar_path)
        .canonicalize()
        .map_err(|_| "The server file is missing. Reinstall this server.".to_owned())?;
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
            return Ok(ProcessStatus {
                running: true,
                exit_code: None,
            });
        }
        servers.remove(&config.id);
    }

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
            let mut script = Command::new("cmd.exe");
            // `cmd /C` needs an explicit `call` for batch files. Without it,
            // paths with spaces can return immediately and Forge/NeoForge looks
            // like it started, then stops before Minecraft is ever launched.
            script
                .arg("/D")
                .arg("/C")
                .arg(format!("call \"{}\" nogui", launch_path.to_string_lossy()));
            script
        }
        #[cfg(not(windows))]
        {
            let mut script = Command::new("sh");
            script.args([launch_path.to_string_lossy().as_ref(), "nogui"]);
            script
        }
    } else {
        let mut java = Command::new("java");
        java.arg(format!("-Xms{}M", config.memory_mb.min(1_024)))
            .arg(format!("-Xmx{}M", config.memory_mb))
            .args(["-jar", launch_path.to_string_lossy().as_ref(), "nogui"]);
        java
    };
    hidden(&mut command);
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
    if let Some(stdout) = child.stdout.take() {
        read_log_stream(stdout, Arc::clone(&logs));
    }
    if let Some(stderr) = child.stderr.take() {
        read_log_stream(stderr, Arc::clone(&logs));
    }

    servers.insert(config.id.clone(), ManagedServer { child, stdin, logs: Arc::clone(&logs) });
    // Let launchers report an immediate configuration or Java failure instead
    // of claiming the world is running. The console remains available in either
    // case, so users can see the real loader error.
    thread::sleep(Duration::from_millis(700));
    let managed = servers.get_mut(&config.id).ok_or("Server state disappeared.")?;
    let exit_code = managed.child.try_wait().map_err(|error| error.to_string())?.and_then(|status| status.code());
    Ok(ProcessStatus {
        running: exit_code.is_none(),
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
        if managed.child.try_wait().map_err(|error| error.to_string())?.is_none() {
            let _ = managed.child.kill();
            let _ = managed.child.wait();
        }
    }
    let target = app_servers_dir(&app)?.join(&id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| format!("Could not remove this server's files: {error}"))?;
    }
    Ok(())
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
        .user_agent("Crew.Ship/0.4 (https://github.com/VirtualFox3/Pack.Host)")
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
        serde_json::to_string(&vec![game_version]).map_err(|error| error.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("Crew.Ship/0.4 (https://github.com/VirtualFox3/Pack.Host)")
        .build()
        .map_err(|error| format!("Could not create the catalog client: {error}"))?;
    let versions: Vec<ModrinthVersion> = client
        .get(format!(
            "https://api.modrinth.com/v2/project/{project_id}/version"
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
        "No compatible release exists for this server version and loader.".to_string()
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
    let directory = app_servers_dir(&app)?.join(server_id).join(directory_name);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the add-on directory: {error}"))?;
    let bytes = http_get(&file.url)?
        .bytes()
        .map_err(|error| format!("Could not download the add-on: {error}"))?;
    fs::write(directory.join(safe_filename), &bytes)
        .map_err(|error| format!("Could not install the add-on: {error}"))?;
    Ok(InstalledAddon {
        name: version.name,
        filename: safe_filename.to_owned(),
        directory: directory.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn server_status(id: String, state: State<'_, HostState>) -> Result<ProcessStatus, String> {
    let mut servers = state.servers.lock().map_err(|_| "State lock failed.")?;
    let Some(server) = servers.get_mut(&id) else {
        return Ok(ProcessStatus {
            running: false,
            exit_code: None,
        });
    };
    let exit = server.child.try_wait().map_err(|error| error.to_string())?;
    Ok(ProcessStatus {
        running: exit.is_none(),
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
fn stop_server(id: String, state: State<'_, HostState>) -> Result<ProcessStatus, String> {
    let mut server = {
        let mut servers = state.servers.lock().map_err(|_| "State lock failed.")?;
        let Some(server) = servers.remove(&id) else {
            return Ok(ProcessStatus {
                running: false,
                exit_code: None,
            });
        };
        server
    };

    if let Some(mut stdin) = server.stdin.take() {
        let _ = stdin.write_all(b"stop\n");
        let _ = stdin.flush();
    }
    for _ in 0..30 {
        if let Some(exit) = server.child.try_wait().map_err(|error| error.to_string())? {
            return Ok(ProcessStatus {
                running: false,
                exit_code: exit.code(),
            });
        }
        thread::sleep(Duration::from_millis(500));
    }
    server.child.kill().map_err(|error| error.to_string())?;
    let exit = server.child.wait().map_err(|error| error.to_string())?;
    Ok(ProcessStatus {
        running: false,
        exit_code: exit.code(),
    })
}

#[tauri::command]
fn start_playit(
    app: AppHandle,
    path: Option<String>,
    state: State<'_, HostState>,
) -> Result<bool, String> {
    let executable = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(find_playit)
        .map(Ok)
        .unwrap_or_else(|| ensure_playit(&app))?;
    if !executable.is_file() {
        return Err("The selected playit.gg executable does not exist.".into());
    }

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
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_status,
            software_versions,
            install_server,
            set_offline_mode,
            server_address,
            start_server,
            stop_server,
            delete_server,
            server_status,
            server_logs,
            server_mods_directory,
            search_modrinth,
            install_modrinth_addon,
            start_playit,
            stop_playit
        ])
        .run(tauri::generate_context!())
        .expect("error while running Crew.Ship");
}
