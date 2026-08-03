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
    game_version: String,
    loader_version: String,
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

#[tauri::command]
fn system_status(app: AppHandle) -> Result<SystemStatus, String> {
    let java_version = command_output("java", &["-version"]);
    let playit = find_playit();
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
fn fabric_versions() -> Result<Vec<String>, String> {
    let versions: Vec<Value> = reqwest::blocking::get(format!("{FABRIC_META}/versions/game"))
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("Fabric's version service is unavailable: {error}"))?
        .json()
        .map_err(|error| format!("Fabric returned an invalid version list: {error}"))?;

    Ok(versions
        .into_iter()
        .filter(|item| item["stable"].as_bool().unwrap_or(false))
        .filter_map(|item| item["version"].as_str().map(ToOwned::to_owned))
        .take(60)
        .collect())
}

#[tauri::command]
fn install_fabric(
    app: AppHandle,
    id: String,
    game_version: String,
) -> Result<InstalledServer, String> {
    safe_id(&id)?;
    if !game_version
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
    {
        return Err("Invalid Minecraft version.".into());
    }

    let entries: Vec<Value> =
        reqwest::blocking::get(format!("{FABRIC_META}/versions/loader/{game_version}"))
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("Fabric does not support that Minecraft version: {error}"))?
            .json()
            .map_err(|error| format!("Fabric returned invalid loader metadata: {error}"))?;

    let entry = entries
        .first()
        .ok_or_else(|| "No Fabric loader exists for that Minecraft version.".to_owned())?;
    let loader = entry["loader"]["version"]
        .as_str()
        .ok_or_else(|| "Fabric metadata did not include a loader version.".to_owned())?;
    let installer = entry["installer"]["version"]
        .as_str()
        .ok_or_else(|| "Fabric metadata did not include an installer version.".to_owned())?;

    let bytes = reqwest::blocking::get(format!(
        "{FABRIC_META}/versions/loader/{game_version}/{loader}/{installer}/server/jar"
    ))
    .and_then(|response| response.error_for_status())
    .map_err(|error| format!("Could not download Fabric: {error}"))?
    .bytes()
    .map_err(|error| format!("Could not read the Fabric download: {error}"))?;

    let directory = app_servers_dir(&app)?.join(&id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the server directory: {error}"))?;
    let jar = directory.join("fabric-server-launch.jar");
    fs::write(&jar, &bytes).map_err(|error| format!("Could not save Fabric: {error}"))?;
    fs::write(directory.join("eula.txt"), "eula=true\n")
        .map_err(|error| format!("Could not accept the Minecraft EULA: {error}"))?;

    Ok(InstalledServer {
        id,
        jar_path: jar.to_string_lossy().into_owned(),
        game_version,
        loader_version: loader.to_owned(),
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

    let jar = Path::new(&config.jar_path)
        .canonicalize()
        .map_err(|_| "The Fabric server file is missing. Reinstall this server.".to_owned())?;
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
        "[Howl.Host] Starting Fabric in the background…".to_owned(),
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
fn start_playit(path: Option<String>, state: State<'_, HostState>) -> Result<bool, String> {
    let executable = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(find_playit)
        .ok_or_else(|| {
            "playit.gg was not found. Install it, then choose its executable.".to_owned()
        })?;
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
            fabric_versions,
            install_fabric,
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
