use std::path::PathBuf;

// Java 21 cannot reliably load classes from verbatim Windows JAR paths.
// Keep canonicalization for validation, but use ordinary paths for processes.
pub fn process_path(path: &std::path::Path) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{unc}"))
    } else if let Some(drive) = value.strip_prefix(r"\\?\") {
        PathBuf::from(drive)
    } else {
        path.to_path_buf()
    }
}

pub fn required_java(game: &str) -> Result<u32, String> {
    let parts: Vec<u32> = game.split('.').map(str::parse).collect::<Result<_, _>>()
        .map_err(|_| "Select a stable Minecraft version before starting.".to_owned())?;
    match parts.as_slice() {
        [year, ..] if *year >= 26 => Ok(25),
        [1, minor, rest @ ..] => Ok(if *minor > 20 || (*minor == 20 && rest.first().copied().unwrap_or(0) >= 5) {21}
            else if *minor >= 18 {17} else if *minor == 17 {16} else {8}),
        _ => Err("Unrecognized Minecraft version.".into()),
    }
}

pub fn java_major(output: &str) -> Option<u32> {
    let version = output.split('"').nth(1)?;
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    if major == 1 { parts.next()?.parse().ok() } else { Some(major) }
}

pub fn java_candidates(major: u32) -> Vec<PathBuf> {
    let mut candidates = vec![];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let root = PathBuf::from(local).join("Crew.Ship/runtimes").join(format!("java-{major}"));
        if let Ok(entries) = std::fs::read_dir(root) {
            candidates.extend(entries.flatten().map(|e| e.path().join("bin/java.exe")));
        }
    }
    for key in [format!("JAVA_{major}_HOME"), "JAVA_HOME".to_owned()] {
        if let Some(path) = std::env::var_os(key) { candidates.push(PathBuf::from(path).join("bin/java.exe")); }
    }
    if let Some(base) = std::env::var_os("ProgramFiles") {
        for vendor in ["Java", "Eclipse Adoptium", "Microsoft", "Amazon Corretto"] {
            if let Ok(entries) = std::fs::read_dir(PathBuf::from(&base).join(vendor)) {
                candidates.extend(entries.flatten().map(|e| e.path().join("bin/java.exe")));
            }
        }
    }
    candidates.push(PathBuf::from("java"));
    candidates
}

pub fn ready_line(line: &str) -> bool { line.contains("Done (") && line.contains("For help") }

pub fn public_address(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() { return Ok(String::new()); }
    if value.len() > 253 || !value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':')) {
        return Err("Enter only a public hostname and optional port, without https:// or a path.".into());
    }
    let mut parts = value.split(':');
    let host = parts.next().unwrap_or("");
    if !host.contains('.') || host.split('.').any(|s| s.is_empty() || s.starts_with('-') || s.ends_with('-')) {
        return Err("Enter the full public hostname shown by Playit.".into());
    }
    if let Some(port) = parts.next() {
        if port.parse::<u16>().ok().filter(|p| *p > 0).is_none() { return Err("Invalid public port.".into()); }
    }
    if parts.next().is_some() { return Err("Invalid address.".into()); }
    Ok(value.to_owned())
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn process_paths_preserve_spaces_and_unc() {
        for (input, expected) in [
            (r"\\?\C:\My Servers\server.jar", r"C:\My Servers\server.jar"),
            (r"\\?\UNC\host\share\server.jar", r"\\host\share\server.jar"),
            (r"C:\servers\run.bat", r"C:\servers\run.bat"),
            ("/tmp/server.jar", "/tmp/server.jar"),
        ] { assert_eq!(process_path(std::path::Path::new(input)), PathBuf::from(expected)); }
    }
    #[test] fn java_version_boundaries() {
        for (game, major) in [("1.16.5",8),("1.17.1",16),("1.18.2",17),("1.20.4",17),("1.20.5",21),("1.21.4",21),("26.1",25)] { assert_eq!(required_java(game),Ok(major)); }
        assert!(required_java("latest").is_err());
    }
    #[test] fn parses_old_and_new_java() { assert_eq!(java_major("java version \"1.8.0_412\""),Some(8)); assert_eq!(java_major("openjdk version \"21.0.4\""),Some(21)); assert_eq!(java_major("missing"),None); }
    #[test] fn readiness_requires_minecraft_marker() { assert!(ready_line("[Server thread/INFO]: Done (2.4s)! For help, type help")); assert!(!ready_line("Starting Minecraft")); }
    #[test] fn validates_public_addresses() { assert_eq!(public_address("example.craft.playit.gg:12345").unwrap(),"example.craft.playit.gg:12345"); for bad in ["https://foo.bar", "foo.bar:0", "foo.bar:99999", "foo.bar/path", "foo.bar:22:33"] {assert!(public_address(bad).is_err());} assert_eq!(public_address("").unwrap(),""); }
}
