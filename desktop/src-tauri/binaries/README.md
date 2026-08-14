# Placeholder external binary

This directory holds the sidecar binary declared in `tauri.conf.json` under
`bundle.externalBin` (`binaries/dsh-desktop`).

The file `dsh-desktop-x86_64-pc-windows-msvc.exe` is an empty placeholder so
that `cargo check` passes — `tauri-build` (Tauri 2.x) validates that each
`externalBin` path resolves to an existing file at compile time.

Task 10 (portable-Node packaging) replaces this placeholder with the real
portable-Node sidecar binary (copied via `desktop/scripts/build-sidecar.mjs`).
Target triples for other platforms (`*-apple-darwin`, `*-unknown-linux-gnu`,
etc.) are added there as well.
