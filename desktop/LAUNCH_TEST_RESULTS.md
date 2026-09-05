# Windows launch-path regression — 2026-09-05

The user's existing Fabric JAR contains `net.fabricmc.installer.ServerLauncher`.
Java 21 `--dry-run -jar` failed to load it with a verbatim `\\?\C:\...`
path and passed with the ordinary path. Java 25 accepted both forms.

The app now converts canonical paths to ordinary process paths before launching
any server type. This includes the working directory, JAR arguments and loader
scripts. UNC network paths retain their leading double slash. A Rust regression
test covers drive paths, paths with spaces, UNC paths and unchanged Unix paths.

## Checks completed

- Five Rust unit tests passed, including the new path regression.
- Desktop TypeScript/Vite and native debug build passed.
- Official Minecraft 1.21.4 Vanilla, Fabric, Paper and Purpur JARs passed Java 21
  main-class loading from an isolated temporary directory containing spaces.
- Official Forge and NeoForge installers for 1.21.4 passed main-class loading.
- Previously installed Forge 1.21.4-54.1.18 passed Java 21 dry-run with its actual
  `win_args.txt` and dependency libraries.

Run `desktop/scripts/test-launch-paths.ps1` to repeat the downloaded-artifact
checks. Artifacts are kept in a unique temporary directory for inspection.

## Limits

Dry-run does not execute the Minecraft main method: it proves main-class loading,
not world initialization, mod compatibility, player joining, tunnel connectivity,
or graceful live shutdown. NeoForge installed-server startup remains unverified.
This is a representative 1.21.4 matrix, not every historical Minecraft version.
No user worlds were changed and no running server was stopped.
The corrected binary is local `target/debug/crew-ship.exe`; the published
v0.5.11 release and any already-running app still contain the old path handling.
