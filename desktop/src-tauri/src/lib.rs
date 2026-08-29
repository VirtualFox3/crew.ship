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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessStatus {
    running: bool,
    exit_code: Option<i32>,
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
        .user_agent("Howl.Host/0.2 (https://github.com/VirtualFox3/Pack.Host)")
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
    })
}

#[tauri::command]
fn software_versions(software: String) -> Result<Vec<String>, String> {
    let url = match software.as_str() {
        "vanilla" => MOJANG_MANIFEST.to_owned(),
        "paper" => PAPER_API.to_owned(),
        "fabric" => format!("{FABRIC_META}/versions/game"),
        _ => return Err("Choose Vanilla, Paper, or Fabric.".into()),
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
        "fabric" => data
            .as_array()
            .ok_or("Fabric returned no versions.")?
            .iter()
            .filter(|item| item["stable"].as_bool().unwrap_or(false))
            .filter_map(|item| item["version"].as_str().map(ToOwned::to_owned))
            .collect(),
        _ => Vec::new(),
    };
    if software == "paper" {
        versions.sort_by(|a, b| version_numbers(b).cmp(&version_numbers(a)));
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

    let (download_url, build_label) = match software.as_str() {
        "fabric" => {
            let entries: Vec<Value> =
                http_get(format!("{FABRIC_META}/versions/loader/{game_version}"))
                    .map_err(|error| format!("Fabric does not support that version: {error}"))?
                    .json()
                    .map_err(|error| format!("Fabric returned invalid metadata: {error}"))?;
            let entry = entries
                .first()
                .ok_or_else(|| "No Fabric loader exists for that version.".to_owned())?;
            let loader = entry["loader"]["version"]
                .as_str()
                .ok_or("Missing Fabric loader version.")?;
            let installer = entry["installer"]["version"]
                .as_str()
                .ok_or("Missing Fabric installer version.")?;
            (
                format!(
                    "{FABRIC_META}/versions/loader/{game_version}/{loader}/{installer}/server/jar"
                ),
                format!("Loader {loader}"),
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
            (url.to_owned(), format!("Build {build_id}"))
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
            (url.to_owned(), "Official".to_owned())
        }
        _ => return Err("Choose Vanilla, Paper, or Fabric.".into()),
    };

    let bytes = http_get(download_url)
        .map_err(|error| format!("Could not download the server: {error}"))?
        .bytes()
        .map_err(|error| format!("Could not read the server download: {error}"))?;

    let directory = app_servers_dir(&app)?.join(&id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the server directory: {error}"))?;
    let jar = directory.join("server.jar");
    fs::write(&jar, &bytes).map_err(|error| format!("Could not save the server: {error}"))?;
    fs::write(directory.join("eula.txt"), "eula=true\n")
        .map_err(|error| format!("Could not accept the Minecraft EULA: {error}"))?;
    set_server_property(
        &directory.join("server.properties"),
        "online-mode",
        if offline_mode { "false" } else { "true" },
    )?;

    Ok(InstalledServer {
        id,
        jar_path: jar.to_string_lossy().into_owned(),
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

    let jar = Path::new(&config.jar_path)
        .canonicalize()
        .map_err(|_| "The server file is missing. Reinstall this server.".to_owned())?;
    let directory = jar
        .parent()
        .ok_or_else(|| "The server folder is invalid.".to_owned())?;

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

    let mut command = Command::new("java");
    hidden(&mut command);
    command
        .current_dir(directory)
        .arg(format!("-Xms{}M", config.memory_mb.min(1_024)))
        .arg(format!("-Xmx{}M", config.memory_mb))
        .args(["-jar", jar.to_string_lossy().as_ref(), "nogui"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        format!("Minecraft could not start. Check that Java is installed: {error}")
    })?;
    let stdin = child.stdin.take();
    let logs = Arc::new(Mutex::new(VecDeque::from([
        "[Howl.Host] Starting Minecraft in the background…".to_owned(),
    ])));
    if let Some(stdout) = child.stdout.take() {
        read_log_stream(stdout, Arc::clone(&logs));
    }
    if let Some(stderr) = child.stderr.take() {
        read_log_stream(stderr, Arc::clone(&logs));
    }

    servers.insert(config.id, ManagedServer { child, stdin, logs });
    Ok(ProcessStatus {
        running: true,
        exit_code: None,
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
    tauri::Builder::default()
        .manage(HostState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            system_status,
            software_versions,
            install_server,
            set_offline_mode,
            start_server,
            stop_server,
            server_status,
            server_logs,
            start_playit,
            stop_playit
        ])
        .run(tauri::generate_context!())
        .expect("error while running Howl.Host");
}
