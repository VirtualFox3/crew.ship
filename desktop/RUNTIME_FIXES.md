# Native server runtime changes

- Java is selected by Minecraft version, not merely by whatever `java` is on PATH.
  Minecraft 1.20.5–1.21.x uses Java 21; 26.x uses Java 25. Older stable
  versions use 8, 16, or 17. Only matching major versions are selected.
- Discovery checks Crew.Ship's private `%LOCALAPPDATA%/Crew.Ship/runtimes/java-N`
  directories, `JAVA_N_HOME`, `JAVA_HOME`, standard Windows vendor directories,
  and PATH. Missing runtimes produce a specific installation message.
  The private runtimes installed on this development computer are not bundled
  into release installers by this change.
- Online requires the Minecraft `Done (...)! For help` log marker. A live
  process without that marker is not advertised as ready. Readiness survives
  rotation of the in-memory console buffer.
- Stop sends the normal `stop` command and waits up to 60 seconds off the UI
  thread. A timeout preserves the process and manager state instead of killing
  a possibly-saving world. Logs remain available after exit. The UI does not
  claim an unverified save succeeded.
- Each server can save its own Playit public hostname/port from its Overview.
  The public address takes priority for display and Copy IP. LAN remains the
  fallback. This is configured address storage, not automatic tunnel discovery
  or an external reachability test. Map Playit to the local port shown there.

Validation: `npm run build` in desktop and `cargo test --lib` in src-tauri.
Native tests cover Java version boundaries/output parsing, ready-log matching,
and public-address validation. They do not constitute an all-version gameplay
test or a network tunnel connectivity test.
