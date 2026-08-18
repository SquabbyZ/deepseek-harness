# DSH Client-First Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DSH's Tauri + Node SEA sidecar architecture with a client-first architecture where WebView2 hosts cordis + all plugins as ESM, and Tauri provides ~12 thin native-bridge commands. Cold-start goes from 30s+ timeout to < 2s; MSI shrinks from ~150 MB to ~80 MB.

**Architecture:** Four layers (Tauri Rust shell → typed IPC bridge → WebView2 DSH runtime → ESM plugins). No Node sidecar. Plugins load via `fetch` → blob URL `import()` → `ctx.plugin(apply)`. Inventory toggles run entirely in-browser via `ctx.loader.entries().update()`.

**Tech Stack:** Tauri 2.x (Rust), React 18 + TanStack Query + Tailwind (existing), cordis (existing, browser-compatible), esbuild for plugin bundles, SQLite (rusqlite), reqwest + keyring + tauri-plugin-store + tauri-plugin-log + tauri-plugin-deep-link + tauri-plugin-updater.

**Spec:** `docs/superpowers/specs/2026-08-19-dsh-client-architecture-refactor-design.md`

---

## Global Constraints

- Target platforms: **Windows + macOS only**. Linux out of scope; CI must reject Linux targets.
- Path discipline: never hardcode `/` or `\` separators. Use `std::path::PathBuf` + `Path::join` in Rust; `URL` APIs in TS. Use `app.path().app_config_dir()` etc., never literal `~/.dsh`.
- Platform detection: prefer `tauri::Manager::platform()`; if dispatching, use a single `Platform` enum. `#[cfg(target_os = "...")]` only in build.rs or platform-specific adapter files, not in business logic.
- Plugin format: `manifest.json` (declaration) + `dist/plugin.js` (browser-safe ESM, `apply(ctx)` export). Two-layer permission model: plugin manifest `permissions` (coarse, user-facing) + Tauri capability (fine-grained, enforced).
- IPC discipline: one `xxxApi.ts` per domain under `apps/web/src/dsh/bridge/`. Types co-located. No direct `invoke()` calls outside this layer.
- State management: TanStack Query only. No Redux/Zustand.
- Every task ends with a passing test + a commit. **No merge to master without green CI.**

---

## Plan Structure: 3 Phases × 11 Slices

| Phase | Slices | Deliverable | Estimated effort |
|---|---|---|---|
| **Phase 1: Foundation** | S1, S2, S3, S4 | Tauri shell + IPC + WebView2 boots empty UI + can install/load/uninstall one plugin end-to-end | ~3 weeks |
| **Phase 2: Ecosystem** | S5, S6, S7 | Inventory UI + ~80 internal plugins migrated + subagent via Tauri shell | ~4 weeks |
| **Phase 3: Ship** | S8, S9, S10, S11 | Headless CLI + theme/i18n + CI + MSI release | ~2 weeks |

Each phase ends with a self-contained, demoable build. Phase 1 must compile and boot before Phase 2 starts.

---

## PHASE 1 — Foundation

### Slice Map

- **S1**: Tauri Shell skeleton — empty WebView2 launches.
- **S2**: Native Bridge — all ~12 commands implemented + tested.
- **S3**: WebView2 DSH Runtime — cordis host boots in browser, TanStack Query wired.
- **S4**: Plugin lifecycle — install / load / uninstall / hash-check end-to-end.

---

### Task 1.1: Tauri shell scaffold compiles + launches empty WebView2 (with platform adapter)

> **2026-08-19 amendment:** Platform-specific code lives in a single `services/platform/` adapter module. Task 1.7 (shell) and Task 1.10 (esbuild verify) call into this adapter, never use `#[cfg(target_os = ...)]` directly in business logic.

**Files:**
- Create: `desktop/src-tauri/Cargo.toml`
- Create: `desktop/src-tauri/tauri.conf.json`
- Create: `desktop/src-tauri/capabilities/default.json`
- Create: `desktop/src-tauri/src/main.rs`
- Create: `desktop/src-tauri/src/lib.rs`
- Create: `desktop/src-tauri/src/state.rs`
- Create: `desktop/src-tauri/src/error.rs`
- Modify: `desktop/package.json` — add `dev`, `build` scripts

**Interfaces:**
- `AppState { db: Database, config_dir: PathBuf }` — set in `setup()` via `app.manage()`, consumed by every command.
- `pub fn run() { ... }` — single entry point in `lib.rs`, called from `main.rs`.

- [ ] **Step 1: Initialize Rust crate**

Run from repo root:
```bash
mkdir -p desktop/src-tauri/src
mkdir -p desktop/src-tauri/capabilities
mkdir -p desktop/src-tauri/icons
cd desktop/src-tauri
cargo init --name dsh-desktop
```

- [ ] **Step 2: Write Cargo.toml**

Write `desktop/src-tauri/Cargo.toml`:
```toml
[package]
name = "dsh-desktop"
version = "0.1.0"
edition = "2021"
rust-version = "1.85"

[lib]
name = "dsh_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon", "protocol-asset"] }
tauri-plugin-store = "2"
tauri-plugin-log = "2"
tauri-plugin-deep-link = "2"
tauri-plugin-updater = "2"
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-process = "2"
tauri-plugin-single-instance = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
keyring = "3"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "fs"] }
tracing = "0.1"
parking_lot = "0.12"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 3: Write tauri.conf.json**

Write `desktop/src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "DeepSeek Harness",
  "version": "0.5.0",
  "identifier": "ai.deepseek.harness.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:3000",
    "beforeDevCommand": "pnpm --dir ../apps/web dev",
    "beforeBuildCommand": "pnpm --dir ../apps/web build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "DeepSeek Harness",
        "width": 1100,
        "height": 720,
        "minWidth": 800,
        "minHeight": 500,
        "visible": false,
        "center": true,
        "decorations": true,
        "resizable": true,
        "titleBarStyle": "Overlay"
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ipc: http://ipc.localhost https:; font-src 'self' data:"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "category": "DeveloperTool",
    "shortDescription": "DeepSeek Harness Desktop",
    "longDescription": "Client-first desktop client for DeepSeek Harness plugin ecosystem.",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"],
    "resources": [],
    "windows": {
      "wix": {
        "template": "wix/per-user-main.wxs"
      }
    },
    "macOS": {
      "minimumSystemVersion": "12.0",
      "entitlements": null,
      "exceptionDomain": ""
    }
  },
  "plugins": {
    "deep-link": {
      "mobile": [],
      "desktop": {
        "schemes": ["dsh"]
      }
    },
    "updater": {
      "pubkey": "REPLACE_WITH_PUBLIC_KEY",
      "endpoints": [
        "https://releases.deepseek-harness.dev/latest.json"
      ]
    }
  }
}
```

- [ ] **Step 4: Write default capabilities**

Write `desktop/src-tauri/capabilities/default.json`:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "DSH desktop default capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-title",
    "core:window:allow-set-focus",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-is-maximized",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "opener:default",
    "log:default"
  ]
}
```

- [ ] **Step 5: Write main.rs**

Write `desktop/src-tauri/src/main.rs`:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dsh_desktop_lib::run()
}
```

- [ ] **Step 6: Write state.rs**

Write `desktop/src-tauri/src/state.rs`:
```rust
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use crate::services::platform;

pub struct AppState {
    pub config_dir: PathBuf,
    pub db: Arc<rusqlite::Connection>,
    pub http: Arc<reqwest::Client>,
    pub platform: platform::Platform,
}

pub type SharedState = Arc<RwLock<AppState>>;
```

- [ ] **Step 6a: Write services/platform.rs (the single platform adapter)**

Write `desktop/src-tauri/src/services/platform.rs`:
```rust
// This module is the ONLY place where #[cfg(target_os = ...)] may appear.
// All business logic (services/, commands/, lib.rs) calls Platform::current()
// and the helper functions here, never cfg directly.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOS,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") { Platform::Windows }
        else if cfg!(target_os = "macos") { Platform::MacOS }
        else { panic!("Linux is out of scope; build should have failed") }
    }
    pub fn is_windows(&self) -> bool { matches!(self, Platform::Windows) }
    pub fn is_macos(&self) -> bool { matches!(self, Platform::MacOS) }
}

/// Shell binaries that are allowed to be spawned by `shell_spawn` command.
pub fn allowed_shell_binaries() -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        &["cmd.exe", "powershell.exe", "node.exe"]
    } else if cfg!(target_os = "macos") {
        &["sh", "bash", "zsh", "/bin/sh", "/usr/bin/env"]
    } else {
        &[] // unreachable — build should have failed
    }
}

pub fn is_shell_binary_allowed(cmd: &str) -> bool {
    allowed_shell_binaries().iter().any(|c| *c == cmd)
}

/// Executable name for running npx from Rust.
pub fn npx_executable_name() -> &'static str {
    if cfg!(target_os = "windows") { "npx.cmd" } else { "npx" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_is_not_panicking() {
        let _ = Platform::current();
    }

    #[test]
    fn allowed_binaries_non_empty() {
        assert!(!allowed_shell_binaries().is_empty());
    }

    #[test]
    fn npx_is_npx_cmd_or_npx() {
        let n = npx_executable_name();
        assert!(n == "npx.cmd" || n == "npx");
    }
}
```

- [ ] **Step 6b: Add `pub mod platform;` to services/mod.rs**

Write `desktop/src-tauri/src/services/mod.rs` (new file):
```rust
pub mod crash;
pub mod platform;
pub mod settings;
```

- [ ] **Step 7: Write error.rs**

Write `desktop/src-tauri/src/error.rs`:
```rust
use serde::Serialize;

#[derive(thiserror::Error, Debug, Serialize)]
#[serde(tag = "code", content = "detail")]
pub enum AppError {
    #[error("Internal error: {message}")]
    Internal { message: String },
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Internal { message: format!("db: {e}") }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Internal { message: format!("io: {e}") }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Internal { message: format!("http: {e}") }
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Internal { message: format!("keyring: {e}") }
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

- [ ] **Step 8: Write lib.rs (skeleton)**

Write `desktop/src-tauri/src/lib.rs`:
```rust
mod error;
mod state;

use std::sync::Arc;
use parking_lot::RwLock;
use tauri::Manager;
use crate::services::platform::Platform;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()
                .map_err(|e| format!("config_dir: {e}"))?;
            std::fs::create_dir_all(&config_dir)?;
            let db_path = config_dir.join("config.sqlite");
            let db = Arc::new(rusqlite::Connection::open(&db_path)?);
            let http = Arc::new(reqwest::Client::builder()
                .user_agent(concat!("DeepSeek-Harness/", env!("CARGO_PKG_VERSION")))
                .build()?);
            let state = AppState {
                config_dir,
                db,
                http,
                platform: Platform::current(),
            };
            app.manage(Arc::new(RwLock::new(state)));

            // Show window on first paint
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running DSH desktop");
}
```

- [ ] **Step 9: Create placeholder web assets**

```bash
mkdir -p desktop/dist
echo '<!doctype html><html><body><h1>DSH Desktop</h1></body></html>' > desktop/dist/index.html
```

- [ ] **Step 10: Build + verify it launches**

Run: `cd desktop && pnpm install && pnpm tauri build --debug`
Expected: compiles, produces an executable. Launch manually → window appears with "DSH Desktop" heading.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/smallMark/Desktop/deepseek-harness
git add desktop/src-tauri desktop/package.json
git commit -m "feat(desktop): tauri 2.x shell skeleton, empty WebView2 launches"
```

---

### Task 1.2: Add `app_version` and `crash_log_path` commands

**Files:**
- Create: `desktop/src-tauri/src/commands/mod.rs`
- Create: `desktop/src-tauri/src/commands/app.rs`
- Modify: `desktop/src-tauri/src/lib.rs` — register commands
- Create: `desktop/src-tauri/src/services/crash.rs`
- Test: `desktop/src-tauri/src/commands/app.rs` (inline `#[cfg(test)]`)

**Interfaces:**
- `app_version() -> AppResult<String>` — returns `env!("CARGO_PKG_VERSION")`.
- `crash_log_path(state: SharedState) -> AppResult<String>` — returns `<config_dir>/crash.log`.

- [ ] **Step 1: Write crash service**

Write `desktop/src-tauri/src/services/crash.rs`:
```rust
use std::path::PathBuf;

pub fn crash_log_path(config_dir: &PathBuf) -> PathBuf {
    config_dir.join("crash.log")
}

pub fn init_panic_hook(config_dir: &PathBuf) {
    let path = crash_log_path(config_dir);
    std::panic::set_hook(Box::new(move |info| {
        let line = format!(
            "{:?}\n",
            serde_json::json!({
                "ts": chrono_now(),
                "panic": info.to_string(),
            })
        );
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
    }));
}

fn chrono_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
```

- [ ] **Step 2: Write commands/mod.rs**

Write `desktop/src-tauri/src/commands/mod.rs`:
```rust
pub mod app;
```

- [ ] **Step 3: Write commands/app.rs with tests**

Write `desktop/src-tauri/src/commands/app.rs`:
```rust
use tauri::State;
use crate::state::SharedState;
use crate::error::AppResult;
use crate::services::crash;

#[tauri::command]
pub fn app_version() -> AppResult<String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
pub fn crash_log_path(state: State<'_, SharedState>) -> AppResult<String> {
    let s = state.read();
    Ok(crash::crash_log_path(&s.config_dir).to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_returns_pkg_version() {
        let v = app_version().unwrap();
        assert!(v.starts_with("0."));
    }
}
```

- [ ] **Step 4: Wire commands into lib.rs**

Modify `desktop/src-tauri/src/lib.rs`:
- Add `mod services; mod commands;` at top
- Add `use commands::app::{app_version, crash_log_path};` import
- Replace `tauri::generate_handler![]` with `tauri::generate_handler![app_version, crash_log_path]`
- In `setup()`, after creating `config_dir`, call `services::crash::init_panic_hook(&config_dir);`

- [ ] **Step 5: Run cargo test**

Run: `cd desktop/src-tauri && cargo test`
Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri
git commit -m "feat(desktop): app_version + crash_log_path commands with panic hook"
```

---

### Task 1.3: Settings persistence via SQLite

**Files:**
- Create: `desktop/src-tauri/src/services/settings.rs`
- Create: `desktop/src-tauri/src/commands/settings.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Test: inline in `services/settings.rs`

**Interfaces:**
- `settings_get(key: String) -> AppResult<Option<JsonValue>>`
- `settings_update(key: String, value: JsonValue) -> AppResult<()>`
- SQL: `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`

- [ ] **Step 1: Write failing test**

Write `desktop/src-tauri/src/services/settings.rs` (test first):
```rust
use rusqlite::Connection;
use serde_json::json;

pub struct SettingsStore<'a>(&'a Connection);

impl<'a> SettingsStore<'a> {
    pub fn new(db: &'a Connection) -> Self { Self(db) }

    pub fn get(&self, key: &str) -> rusqlite::Result<Option<serde_json::Value>> { todo!() }
    pub fn set(&self, key: &str, value: &serde_json::Value) -> rusqlite::Result<()> { todo!() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").unwrap();
        conn
    }

    #[test]
    fn roundtrip() {
        let conn = setup_db();
        let store = SettingsStore::new(&conn);
        assert!(store.get("foo").unwrap().is_none());
        store.set("foo", &json!({"a": 1})).unwrap();
        assert_eq!(store.get("foo").unwrap(), json!({"a": 1}));
    }
}
```

- [ ] **Step 2: Run test (fails)**

Run: `cd desktop/src-tauri && cargo test services::settings`
Expected: FAIL with `not yet implemented`.

- [ ] **Step 3: Implement SettingsStore**

Replace `get` and `set` in `services/settings.rs`:
```rust
impl<'a> SettingsStore<'a> {
    pub fn get(&self, key: &str) -> rusqlite::Result<Option<serde_json::Value>> {
        let mut stmt = self.0.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        if let Some(row) = rows.next()? {
            let text: String = row.get(0)?;
            Ok(Some(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null)))
        } else {
            Ok(None)
        }
    }

    pub fn set(&self, key: &str, value: &serde_json::Value) -> rusqlite::Result<()> {
        let text = serde_json::to_string(value).unwrap();
        self.0.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, text],
        )?;
        Ok(())
    }
}
```

- [ ] **Step 4: Run test (passes)**

Run: `cd desktop/src-tauri && cargo test services::settings`
Expected: 1 test passes.

- [ ] **Step 5: Wire commands/settings.rs**

Write `desktop/src-tauri/src/commands/settings.rs`:
```rust
use tauri::State;
use serde_json::Value;
use crate::state::SharedState;
use crate::error::{AppError, AppResult};
use crate::services::settings::SettingsStore;

#[tauri::command]
pub fn settings_get(key: String, state: State<'_, SharedState>) -> AppResult<Option<Value>> {
    let s = state.read();
    SettingsStore::new(&s.db).get(&key).map_err(AppError::from)
}

#[tauri::command]
pub fn settings_update(key: String, value: Value, state: State<'_, SharedState>) -> AppResult<()> {
    let s = state.read();
    SettingsStore::new(&s.db).set(&key, &value).map_err(AppError::from)
}
```

- [ ] **Step 6: Wire schema init + commands into lib.rs**

In `lib.rs`:
- Add `services::settings::SettingsStore::new(&db).init_schema()?;` (add `init_schema()` helper to SettingsStore that runs `CREATE TABLE IF NOT EXISTS`)
- Register `settings_get, settings_update` in `generate_handler!`

- [ ] **Step 7: Commit**

```bash
git add desktop/src-tauri
git commit -m "feat(desktop): settings_get/settings_update via SQLite"
```

---

### Task 1.4: Credentials via OS keyring

**Files:**
- Create: `desktop/src-tauri/src/services/credentials.rs`
- Create: `desktop/src-tauri/src/commands/credentials.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Test: `tests/credentials.rs`

**Interfaces:**
- `credentials_get(key: String) -> AppResult<Option<String>>`
- `credentials_set(key: String, value: String) -> AppResult<()>`
- `credentials_delete(key: String) -> AppResult<()>`
- Service name: `DSH Desktop`, account = key.

- [ ] **Step 1: Write credentials service**

Write `desktop/src-tauri/src/services/credentials.rs`:
```rust
use keyring::Entry;
use crate::error::{AppError, AppResult};

const SERVICE: &str = "DSH Desktop";

pub fn get(key: &str) -> AppResult<Option<String>> {
    let entry = Entry::new(SERVICE, key).map_err(AppError::from)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::from(e)),
    }
}

pub fn set(key: &str, value: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE, key).map_err(AppError::from)?;
    entry.set_password(value).map_err(AppError::from)
}

pub fn delete(key: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE, key).map_err(AppError::from)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::from(e)),
    }
}
```

- [ ] **Step 2: Write commands/credentials.rs**

Write `desktop/src-tauri/src/commands/credentials.rs`:
```rust
use crate::error::AppResult;
use crate::services::credentials;

#[tauri::command]
pub fn credentials_get(key: String) -> AppResult<Option<String>> { credentials::get(&key) }

#[tauri::command]
pub fn credentials_set(key: String, value: String) -> AppResult<()> {
    credentials::set(&key, &value)
}

#[tauri::command]
pub fn credentials_delete(key: String) -> AppResult<()> {
    credentials::delete(&key)
}
```

- [ ] **Step 3: Register commands**

In `lib.rs`: add to `generate_handler!`.

- [ ] **Step 4: Manual test (no automated test for keyring)**

```bash
cd desktop && pnpm tauri dev
# In devtools console:
# await window.__TAURI__.core.invoke('credentials_set', { key: 'test', value: 'hello' })
# await window.__TAURI__.core.invoke('credentials_get', { key: 'test' })  // → 'hello'
# await window.__TAURI__.core.invoke('credentials_delete', { key: 'test' })
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri
git commit -m "feat(desktop): credentials get/set/delete via OS keyring"
```

---

### Task 1.5: Filesystem commands with allowlist

**Files:**
- Create: `desktop/src-tauri/src/services/fs.rs`
- Create: `desktop/src-tauri/src/commands/fs.rs`
- Modify: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- `fs_read(path: String) -> AppResult<Vec<u8>>`
- `fs_write(path: String, content: Vec<u8>) -> AppResult<()>`
- `fs_list(dir: String) -> AppResult<Vec<FsEntry>>`
- `fs_exists(path: String) -> AppResult<bool>`
- Allowlist: `<config_dir>/*` only. Everything else rejected with `FsPermissionDenied`.

- [ ] **Step 1: Write services/fs.rs**

Write `desktop/src-tauri/src/services/fs.rs`:
```rust
use std::path::{Path, PathBuf};
use serde::Serialize;
use crate::error::{AppError, AppResult};

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

pub fn is_allowed(config_dir: &Path, path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else { return false };
    let Ok(config_canonical) = config_dir.canonicalize() else { return false };
    canonical.starts_with(config_canonical)
}

pub fn read(config_dir: &Path, path: &Path) -> AppResult<Vec<u8>> {
    if !is_allowed(config_dir, path) {
        return Err(AppError::FsPermissionDenied { path: path.to_string_lossy().into_owned() });
    }
    std::fs::read(path).map_err(|e| AppError::FsIo { message: e.to_string() })
}

pub fn write(config_dir: &Path, path: &Path, content: &[u8]) -> AppResult<()> {
    if !is_allowed(config_dir, path) {
        return Err(AppError::FsPermissionDenied { path: path.to_string_lossy().into_owned() });
    }
    std::fs::write(path, content).map_err(|e| AppError::FsIo { message: e.to_string() })
}

pub fn list(config_dir: &Path, dir: &Path) -> AppResult<Vec<FsEntry>> {
    if !is_allowed(config_dir, dir) {
        return Err(AppError::FsPermissionDenied { path: dir.to_string_lossy().into_owned() });
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| AppError::FsIo { message: e.to_string() })? {
        let entry = entry.map_err(|e| AppError::FsIo { message: e.to_string() })?;
        let metadata = entry.metadata().map_err(|e| AppError::FsIo { message: e.to_string() })?;
        out.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    Ok(out)
}

pub fn exists(config_dir: &Path, path: &Path) -> bool {
    is_allowed(config_dir, path) && path.exists()
}
```

- [ ] **Step 2: Add error variants**

Append to `desktop/src-tauri/src/error.rs` enum:
```rust
    #[error("Filesystem permission denied: {path} not in allowlist")]
    FsPermissionDenied { path: String },

    #[error("Filesystem IO error: {message}")]
    FsIo { message: String },
```

- [ ] **Step 3: Write commands/fs.rs**

Write `desktop/src-tauri/src/commands/fs.rs`:
```rust
use std::path::PathBuf;
use tauri::State;
use crate::state::SharedState;
use crate::error::AppResult;
use crate::services::fs::{self, FsEntry};

#[tauri::command]
pub fn fs_read(path: String, state: State<'_, SharedState>) -> AppResult<Vec<u8>> {
    let s = state.read();
    fs::read(&s.config_dir, &PathBuf::from(path))
}

#[tauri::command]
pub fn fs_write(path: String, content: Vec<u8>, state: State<'_, SharedState>) -> AppResult<()> {
    let s = state.read();
    fs::write(&s.config_dir, &PathBuf::from(path), &content)
}

#[tauri::command]
pub fn fs_list(dir: String, state: State<'_, SharedState>) -> AppResult<Vec<FsEntry>> {
    let s = state.read();
    fs::list(&s.config_dir, &PathBuf::from(dir))
}

#[tauri::command]
pub fn fs_exists(path: String, state: State<'_, SharedState>) -> AppResult<bool> {
    let s = state.read();
    Ok(fs::exists(&s.config_dir, &PathBuf::from(path)))
}
```

- [ ] **Step 4: Register commands + write capability entries**

In `capabilities/default.json`, add:
```json
"fs:allow-read",
"fs:allow-write",
"fs:allow-list",
"fs:allow-exists"
```

In `lib.rs`: register in `generate_handler!`. Add `pub mod fs;` to `commands/mod.rs`.

- [ ] **Step 5: Write Rust unit test for allowlist**

In `services/fs.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn allowlist_rejects_outside_config() {
        let config = temp_dir().join("dsh_test_config");
        std::fs::create_dir_all(&config).unwrap();
        let outside = std::env::temp_dir().join("dsh_test_outside");
        assert!(!is_allowed(&config, &outside));
        assert!(is_allowed(&config, &config.join("subfile")));
    }
}
```

- [ ] **Step 6: Run tests + commit**

```bash
cd desktop/src-tauri && cargo test
git add desktop/src-tauri
git commit -m "feat(desktop): fs read/write/list/exists with config_dir allowlist"
```

---

### Task 1.6: HTTP request command (bypass CORS via reqwest)

**Files:**
- Create: `desktop/src-tauri/src/services/http_client.rs`
- Create: `desktop/src-tauri/src/commands/http.rs`
- Modify: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- `http_request(req: HttpRequest) -> AppResult<HttpResponse>` where
  - `HttpRequest { method: String, url: String, headers: HashMap<String,String>, body: Option<Vec<u8>>, timeout_ms: Option<u64> }`
  - `HttpResponse { status: u16, headers: HashMap<String,String>, body: Vec<u8> }`

- [ ] **Step 1: Write services/http_client.rs**

```rust
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};

#[derive(Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<Vec<u8>>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub async fn execute(client: &reqwest::Client, req: HttpRequest) -> AppResult<HttpResponse> {
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| AppError::Internal { message: format!("bad method: {e}") })?;

    let mut builder = client.request(method, &req.url);
    let mut header_map = HeaderMap::new();
    for (k, v) in req.headers {
        let name = HeaderName::from_bytes(k.as_bytes())
            .map_err(|e| AppError::Internal { message: format!("bad header name: {e}") })?;
        let value = HeaderValue::from_bytes(v.as_bytes())
            .map_err(|e| AppError::Internal { message: format!("bad header value: {e}") })?;
        header_map.insert(name, value);
    }
    builder = builder.headers(header_map);
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    if let Some(timeout_ms) = req.timeout_ms {
        builder = builder.timeout(std::time::Duration::from_millis(timeout_ms));
    }

    let resp = builder.send().await?;
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers() {
        headers.insert(k.to_string(), v.to_str().unwrap_or("").to_string());
    }
    let body = resp.bytes().await?;
    Ok(HttpResponse { status, headers, body: body.to_vec() })
}
```

- [ ] **Step 2: Write commands/http.rs**

```rust
use tauri::State;
use crate::state::SharedState;
use crate::error::AppResult;
use crate::services::http_client::{self, HttpRequest, HttpResponse};

#[tauri::command]
pub async fn http_request(
    req: HttpRequest,
    state: State<'_, SharedState>,
) -> AppResult<HttpResponse> {
    let s = state.read();
    http_client::execute(&s.http, req).await
}
```

- [ ] **Step 3: Register command + capability entry**

In `capabilities/default.json`, add `"http:allow-request"`.
In `commands/mod.rs`, add `pub mod http;`.
In `lib.rs`, register in `generate_handler!`.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri
git commit -m "feat(desktop): http_request via reqwest (bypasses CORS)"
```

---

### Task 1.7: Dialog + shell + deeplink commands

**Files:**
- Create: `desktop/src-tauri/src/commands/dialog.rs`
- Create: `desktop/src-tauri/src/commands/shell.rs`
- Create: `desktop/src-tauri/src/services/deeplink.rs`
- Create: `desktop/src-tauri/src/commands/deeplink.rs`
- Modify: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- `dialog_open(opts: OpenOpts) -> AppResult<Option<String>>` — `OpenOpts { directory: bool, filters: Vec<Filter> }`
- `dialog_save(opts: SaveOpts) -> AppResult<Option<String>>`
- `dialog_message(opts: MsgOpts) -> AppResult<()>` — `{ kind: Info|Warn|Error, text: String }`
- `shell_spawn(spec: ShellSpec) -> AppResult<ShellHandle>` — `{ cmd: String, args: Vec<String>, cwd: Option<String> }`. Allowlist: only `cmd == "cmd.exe" / "sh"` and `args` first element in `/usr/bin/` or `C:\Windows\System32\`.
- `deeplink_parse(url: String) -> AppResult<ParsedDeeplink>` — strict allowlist: scheme `dsh://`, path `/v1/install` or `/v1/import`, query params allowlisted.
- `deeplink_import(parsed: ParsedDeeplink) -> AppResult<ImportResult>`

- [ ] **Step 1: Write commands/dialog.rs**

```rust
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use crate::error::AppResult;

#[derive(Deserialize)]
pub struct OpenOpts {
    #[serde(default)]
    pub directory: bool,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Deserialize)]
pub struct Filter { pub name: String, pub extensions: Vec<String> }

#[derive(Deserialize)]
pub struct SaveOpts {
    pub default_name: Option<String>,
    pub filters: Vec<Filter>,
}

#[derive(Deserialize)]
pub struct MsgOpts {
    pub kind: String,  // "info" | "warn" | "error"
    pub text: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[tauri::command]
pub async fn dialog_open(opts: OpenOpts, app: tauri::AppHandle) -> AppResult<Option<String>> {
    let mut builder = app.dialog().file();
    if opts.directory { builder = builder.pick_folder(|_| {}); }
    else {
        let filters = opts.filters.into_iter().map(|f| {
            tauri_plugin_dialog::FileFilter::new(f.name).extensions(&f.extensions)
        }).collect();
        builder = builder.add_filter("files", &["*"]).pick_file(|_| {});
        builder = builder.set_filters(filters);
    }
    if let Some(t) = opts.title { builder = builder.set_title(&t); }
    let path = tokio::task::spawn_blocking(move || {
        builder.blocking_pick_file()
    }).await.ok().flatten();
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn dialog_save(opts: SaveOpts, app: tauri::AppHandle) -> AppResult<Option<String>> {
    let mut builder = app.dialog().file()
        .add_filter("files", &["*"])
        .set_file_name(opts.default_name.unwrap_or_else(|| "untitled".into()));
    builder = builder.set_filters(opts.filters.into_iter().map(|f| {
        tauri_plugin_dialog::FileFilter::new(f.name).extensions(&f.extensions)
    }).collect());
    let path = tokio::task::spawn_blocking(move || builder.blocking_save_file()).await.ok().flatten();
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn dialog_message(opts: MsgOpts, app: tauri::AppHandle) -> AppResult<()> {
    let kind = match opts.kind.as_str() {
        "warn" => tauri_plugin_dialog::MessageDialogKind::Warning,
        "error" => tauri_plugin_dialog::MessageDialogKind::Error,
        _ => tauri_plugin_dialog::MessageDialogKind::Info,
    };
    app.dialog()
        .message(opts.text)
        .title(opts.title.unwrap_or_else(|| "DeepSeek Harness".into()))
        .kind(kind)
        .buttons(MessageDialogButtons::Ok)
        .blocking_show();
    Ok(())
}
```

- [ ] **Step 2: Write commands/shell.rs**

```rust
use serde::Deserialize;
use tauri::State;
use crate::state::SharedState;
use crate::error::{AppError, AppResult};
use crate::services::platform;
use std::path::PathBuf;

#[derive(Deserialize)]
pub struct ShellSpec {
    pub cmd: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub async fn shell_spawn(spec: ShellSpec, state: State<'_, SharedState>) -> AppResult<u64> {
    if !platform::is_shell_binary_allowed(&spec.cmd) {
        return Err(AppError::PermissionDenied { cmd: spec.cmd });
    }
    let mut cmd = tokio::process::Command::new(&spec.cmd);
    cmd.args(&spec.args);
    if let Some(cwd) = &spec.cwd {
        let p = PathBuf::from(cwd);
        if !p.starts_with(&state.read().config_dir) {
            return Err(AppError::PermissionDenied { cmd: spec.cmd });
        }
        cmd.current_dir(p);
    }
    cmd.envs(&spec.env);
    let child = cmd.spawn().map_err(|e| AppError::Shell { message: e.to_string() })?;
    Ok(child.id().unwrap_or(0))
}
```

- [ ] **Step 3: Add shell error variants**

Append to `error.rs`:
```rust
    #[error("Shell permission denied: {cmd}")]
    PermissionDenied { cmd: String },

    #[error("Shell error: {message}")]
    Shell { message: String },

    #[error("Deeplink parse failed: {url} — {reason}")]
    DeeplinkParse { url: String, reason: String },
```

- [ ] **Step 4: Write services/deeplink.rs**

```rust
use serde::{Deserialize, Serialize};
use url::Url;
use crate::error::{AppError, AppResult};

#[derive(Deserialize, Serialize, Debug)]
#[serde(tag = "kind")]
pub enum ParsedDeeplink {
    Install { spec: String, name: Option<String> },
    Import { resource: String, config: serde_json::Value },
}

pub fn parse(url: &str) -> AppResult<ParsedDeeplink> {
    let parsed = Url::parse(url).map_err(|e| AppError::DeeplinkParse { url: url.to_string(), reason: e.to_string() })?;
    if parsed.scheme() != "dsh" {
        return Err(AppError::DeeplinkParse { url: url.to_string(), reason: format!("scheme must be dsh://, got {}", parsed.scheme()) });
    }
    match parsed.path() {
        "/v1/install" => {
            let spec = parsed.query_pairs()
                .find(|(k, _)| k == "spec")
                .map(|(_, v)| v.into_owned())
                .ok_or_else(|| AppError::DeeplinkParse { url: url.to_string(), reason: "missing spec".into() })?;
            let name = parsed.query_pairs().find(|(k, _)| k == "name").map(|(_, v)| v.into_owned());
            Ok(ParsedDeeplink::Install { spec, name })
        }
        "/v1/import" => {
            let resource = parsed.query_pairs().find(|(k, _)| k == "resource").map(|(_, v)| v.into_owned())
                .ok_or_else(|| AppError::DeeplinkParse { url: url.to_string(), reason: "missing resource".into() })?;
            if !matches!(resource.as_str(), "plugin" | "skill" | "mcp" | "agent") {
                return Err(AppError::DeeplinkParse { url: url.to_string(), reason: format!("unknown resource {resource}") });
            }
            // config is JSON-encoded in query param
            let cfg_str = parsed.query_pairs().find(|(k, _)| k == "config").map(|(_, v)| v.into_owned())
                .ok_or_else(|| AppError::DeeplinkParse { url: url.to_string(), reason: "missing config".into() })?;
            let config: serde_json::Value = serde_json::from_str(&cfg_str)
                .map_err(|e| AppError::DeeplinkParse { url: url.to_string(), reason: format!("bad config json: {e}") })?;
            Ok(ParsedDeeplink::Import { resource, config })
        }
        _ => Err(AppError::DeeplinkParse { url: url.to_string(), reason: format!("unknown path {}", parsed.path()) }),
    }
}
```

- [ ] **Step 5: Write commands/deeplink.rs**

```rust
use tauri::State;
use crate::state::SharedState;
use crate::error::AppResult;
use crate::services::deeplink::{self, ParsedDeeplink};

#[tauri::command]
pub fn deeplink_parse(url: String) -> AppResult<ParsedDeeplink> {
    deeplink::parse(&url)
}

#[tauri::command]
pub fn deeplink_import(parsed: ParsedDeeplink, _state: State<'_, SharedState>) -> AppResult<serde_json::Value> {
    // Phase 1: stub returns parsed back. Phase 2 (S4) wires to plugin_install.
    Ok(serde_json::json!({ "parsed": parsed }))
}
```

- [ ] **Step 6: Register commands + capabilities**

Add to `commands/mod.rs`: `pub mod dialog; pub mod shell; pub mod deeplink;`
Add to `capabilities/default.json`: dialog/shell/deeplink permissions.
Register in `generate_handler!`.

- [ ] **Step 7: Add `url` dependency**

In `Cargo.toml`:
```toml
url = "2"
```

- [ ] **Step 8: Commit**

```bash
cd desktop/src-tauri && cargo build
git add desktop/src-tauri
git commit -m "feat(desktop): dialog + shell + deeplink commands with allowlists"
```

---

### Task 1.8: Plugin registry SQLite schema

**Files:**
- Create: `desktop/src-tauri/src/services/plugin_registry.rs`
- Test: inline

**Interfaces:**
- Schema:
  ```sql
  CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      installed_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
  );
  ```
- `PluginRecord { id, name, version, manifest_json, content_hash, installed_at, source, enabled }`
- Methods: `list() -> Vec<PluginRecord>`, `get(id) -> Option<PluginRecord>`, `insert(rec)`, `update_enabled(id, enabled)`, `delete(id)`.

- [ ] **Step 1: Write failing tests + skeleton**

Write `services/plugin_registry.rs`:
```rust
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub manifest_json: String,
    pub content_hash: String,
    pub installed_at: i64,
    pub source: String,
    pub enabled: bool,
}

pub struct PluginRegistry<'a>(&'a Connection);

impl<'a> PluginRegistry<'a> {
    pub fn new(db: &'a Connection) -> Self { Self(db) }

    pub fn init_schema(&self) -> rusqlite::Result<()> {
        self.0.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                manifest_json TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                installed_at INTEGER NOT NULL,
                source TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1
            );
        "#)
    }

    pub fn list(&self) -> rusqlite::Result<Vec<PluginRecord>> { todo!() }
    pub fn get(&self, id: &str) -> rusqlite::Result<Option<PluginRecord>> { todo!() }
    pub fn insert(&self, rec: &PluginRecord) -> rusqlite::Result<()> { todo!() }
    pub fn update_enabled(&self, id: &str, enabled: bool) -> rusqlite::Result<()> { todo!() }
    pub fn delete(&self, id: &str) -> rusqlite::Result<()> { todo!() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        let reg = PluginRegistry::new(&conn);
        reg.init_schema().unwrap();
        conn
    }

    fn sample(id: &str) -> PluginRecord {
        PluginRecord {
            id: id.to_string(),
            name: "test".into(),
            version: "0.1.0".into(),
            manifest_json: "{}".into(),
            content_hash: "abc".into(),
            installed_at: 0,
            source: "npm:test".into(),
            enabled: true,
        }
    }

    #[test]
    fn roundtrip() {
        let conn = setup_db();
        let reg = PluginRegistry::new(&conn);
        reg.insert(&sample("p1")).unwrap();
        let got = reg.get("p1").unwrap().unwrap();
        assert_eq!(got.id, "p1");
        assert!(got.enabled);

        reg.update_enabled("p1", false).unwrap();
        assert!(!reg.get("p1").unwrap().unwrap().enabled);

        reg.delete("p1").unwrap();
        assert!(reg.get("p1").unwrap().is_none());

        assert_eq!(reg.list().unwrap().len(), 0);
    }
}
```

- [ ] **Step 2: Run tests (fail)**

Run: `cd desktop/src-tauri && cargo test services::plugin_registry`
Expected: FAIL with `not yet implemented`.

- [ ] **Step 3: Implement methods**

```rust
    pub fn list(&self) -> rusqlite::Result<Vec<PluginRecord>> {
        let mut stmt = self.0.prepare(
            "SELECT id, name, version, manifest_json, content_hash, installed_at, source, enabled FROM plugins"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(PluginRecord {
                id: r.get(0)?,
                name: r.get(1)?,
                version: r.get(2)?,
                manifest_json: r.get(3)?,
                content_hash: r.get(4)?,
                installed_at: r.get(5)?,
                source: r.get(6)?,
                enabled: r.get::<_, i64>(7)? != 0,
            })
        })?;
        rows.collect()
    }

    pub fn get(&self, id: &str) -> rusqlite::Result<Option<PluginRecord>> {
        let mut stmt = self.0.prepare(
            "SELECT id, name, version, manifest_json, content_hash, installed_at, source, enabled FROM plugins WHERE id = ?1"
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(r) = rows.next()? {
            Ok(Some(PluginRecord {
                id: r.get(0)?, name: r.get(1)?, version: r.get(2)?,
                manifest_json: r.get(3)?, content_hash: r.get(4)?,
                installed_at: r.get(5)?, source: r.get(6)?,
                enabled: r.get::<_, i64>(7)? != 0,
            }))
        } else { Ok(None) }
    }

    pub fn insert(&self, rec: &PluginRecord) -> rusqlite::Result<()> {
        self.0.execute(
            "INSERT OR REPLACE INTO plugins (id, name, version, manifest_json, content_hash, installed_at, source, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![rec.id, rec.name, rec.version, rec.manifest_json, rec.content_hash,
                    rec.installed_at, rec.source, rec.enabled as i64],
        )?;
        Ok(())
    }

    pub fn update_enabled(&self, id: &str, enabled: bool) -> rusqlite::Result<()> {
        self.0.execute(
            "UPDATE plugins SET enabled = ?2 WHERE id = ?1",
            params![id, enabled as i64],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> rusqlite::Result<()> {
        self.0.execute("DELETE FROM plugins WHERE id = ?1", params![id])?;
        Ok(())
    }
```

- [ ] **Step 4: Run tests (pass) + commit**

```bash
cd desktop/src-tauri && cargo test services::plugin_registry
git add desktop/src-tauri
git commit -m "feat(desktop): plugin registry SQLite CRUD"
```

---

### Task 1.9: Plugin install service (npm / GitHub / folder)

**Files:**
- Create: `desktop/src-tauri/src/services/plugin_install.rs`
- Create: `desktop/src-tauri/src/commands/plugin.rs` (skeleton — list, readFile, getManifest; full install in next task)
- Test: `services/plugin_install.rs` with fixtures

**Interfaces:**
- `parse_spec(spec: &str) -> InstallSpec { kind: Npm | Git | Folder, ref: String }`
- `download_npm(name: &str, http: &reqwest::Client) -> InstallSpec { tarball_url, package_meta }`
- `download_git(url: &str, http: &reqwest::Client) -> InstallSpec { tarball_url }`
- `verify_browser_safe(esbuild_metafile: ...) -> AppResult<()>`

- [ ] **Step 1: Write parse_spec + failing tests**

Write `services/plugin_install.rs` (initial):
```rust
use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum InstallSpec {
    Npm { name: String, version_req: Option<String> },
    Git { url: String, branch: Option<String> },
    Folder { path: String },
}

pub fn parse_spec(spec: &str) -> AppResult<InstallSpec> {
    if let Some(rest) = spec.strip_prefix("npm:") {
        let parts: Vec<&str> = rest.split('@').collect();
        let name = if parts.len() > 1 && !parts[0].is_empty() {
            format!("@{}", parts[0])
        } else {
            rest.to_string()
        };
        let version_req = parts.get(1).map(|s| s.to_string()).filter(|s| !s.is_empty());
        Ok(InstallSpec::Npm { name, version_req })
    } else if spec.starts_with("git+") || spec.starts_with("github:") || spec.contains(".git") {
        Ok(InstallSpec::Git { url: spec.to_string(), branch: None })
    } else if spec.starts_with("folder:") || spec.starts_with("/") || spec.contains(":\\") {
        let path = spec.strip_prefix("folder:").unwrap_or(spec).to_string();
        Ok(InstallSpec::Folder { path })
    } else {
        // Default: try as npm package
        Ok(InstallSpec::Npm { name: spec.to_string(), version_req: None })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_npm_with_at_scope() {
        let s = parse_spec("npm:@user/dsh-x").unwrap();
        match s { InstallSpec::Npm { name, .. } => assert_eq!(name, "@user/dsh-x"), _ => panic!() }
    }

    #[test]
    fn parses_git() {
        let s = parse_spec("git+https://github.com/user/repo.git").unwrap();
        assert!(matches!(s, InstallSpec::Git { .. }));
    }

    #[test]
    fn parses_folder() {
        let s = parse_spec("folder:/some/path").unwrap();
        assert!(matches!(s, InstallSpec::Folder { .. }));
    }

    #[test]
    fn defaults_to_npm() {
        let s = parse_spec("plain-pkg-name").unwrap();
        assert!(matches!(s, InstallSpec::Npm { .. }));
    }
}
```

- [ ] **Step 2: Run tests (pass) since impl is there**

Run: `cd desktop/src-tauri && cargo test services::plugin_install::tests`
Expected: 4 tests pass.

- [ ] **Step 3: Implement download_npm**

Add to `services/plugin_install.rs`:
```rust
use serde::Deserialize;

#[derive(Deserialize)]
struct NpmMeta {
    #[serde(rename = "dist")]
    dist: NpmDist,
    version: String,
}

#[derive(Deserialize)]
struct NpmDist {
    tarball: String,
}

pub async fn npm_tarball_url(name: &str, http: &reqwest::Client) -> AppResult<String> {
    let url = format!("https://registry.npmjs.org/{name}/latest");
    let resp = http.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Network { message: format!("npm meta {name}: {}", resp.status()), status: Some(resp.status().as_u16()) });
    }
    let meta: NpmMeta = resp.json().await?;
    Ok(meta.dist.tarball)
}
```

- [ ] **Step 4: Add Network error variant**

Append to `error.rs`:
```rust
    #[error("Network error: {message}")]
    Network { message: String, status: Option<u16> },
```

- [ ] **Step 5: Commit**

```bash
cd desktop/src-tauri && cargo test
git add desktop/src-tauri
git commit -m "feat(desktop): plugin install spec parsing + npm tarball resolution"
```

---

### Task 1.10: Plugin manifest validation + esbuild browser-safe check

**Files:**
- Create: `desktop/src-tauri/src/services/manifest.rs`
- Test: inline with fixture manifests

**Interfaces:**
- `Manifest { name, version, kind, platforms, host, permissions, entry, client }`
- `parse(manifest_json: &str) -> AppResult<Manifest>`
- `verify_browser_safe(plugin_dir: &Path) -> AppResult<()>` — runs esbuild as subprocess with `--metafile`, checks no Node built-ins.

- [ ] **Step 1: Write manifest schema**

Write `services/manifest.rs`:
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub name: String,
    pub version: String,
    pub kind: String,                  // plugin | skill | mcp | agent
    #[serde(default)]
    pub platforms: HashMap<String, String>,
    #[serde(default = "default_host")]
    pub host: String,                  // browser | node
    pub permissions: Vec<String>,
    pub entry: String,
    #[serde(default)]
    pub client: Option<String>,
}

fn default_host() -> String { "browser".to_string() }

pub fn parse(manifest_json: &str) -> AppResult<Manifest> {
    let m: Manifest = serde_json::from_str(manifest_json)
        .map_err(|e| AppError::InvalidManifest { field: "root".into(), hint: e.to_string() })?;
    if m.kind != "plugin" && m.kind != "skill" && m.kind != "mcp" && m.kind != "agent" {
        return Err(AppError::InvalidManifest { field: "kind".into(), hint: format!("must be plugin/skill/mcp/agent, got {}", m.kind) });
    }
    if m.host != "browser" && m.host != "node" {
        return Err(AppError::InvalidManifest { field: "host".into(), hint: format!("must be browser/node, got {}", m.host) });
    }
    if m.permissions.is_empty() {
        return Err(AppError::InvalidManifest { field: "permissions".into(), hint: "must declare at least one permission".into() });
    }
    Ok(m)
}

const NODE_BUILTINS: &[&str] = &[
    "fs", "path", "os", "child_process", "crypto", "buffer", "stream", "events",
    "url", "http", "https", "net", "tls", "zlib", "util", "querystring",
    "readline", "vm", "worker_threads", "cluster", "dgram", "dns",
];

pub async fn verify_browser_safe(plugin_dir: &Path) -> AppResult<()> {
    let entry_path = plugin_dir.join("dist/plugin.js");
    if !entry_path.exists() {
        return Err(AppError::PluginNotBrowserSafe { issue: "missing dist/plugin.js".into(), file: entry_path.to_string_lossy().into_owned() });
    }
    let content = std::fs::read_to_string(&entry_path)
        .map_err(|e| AppError::FsIo { message: e.to_string() })?;

    // 1. AST check via esbuild subprocess (sandboxed)
    use crate::services::platform::npx_executable_name;
    let output = tokio::process::Command::new(npx_executable_name())
        .arg("--no-install")
        .arg("esbuild")
        .arg("--bundle=false")
        .arg("--metafile")
        .arg("--platform=browser")
        .arg("--format=esm")
        .arg(&entry_path)
        .output()
        .await
        .map_err(|e| AppError::PluginNotBrowserSafe { issue: format!("esbuild spawn: {e}"), file: entry_path.to_string_lossy().into_owned() })?;

    if !output.status.success() {
        return Err(AppError::PluginNotBrowserSafe {
            issue: format!("esbuild failed: {}", String::from_utf8_lossy(&output.stderr)),
            file: entry_path.to_string_lossy().into_owned(),
        });
    }

    // 2. String-level check: no `require('fs')` etc.
    for builtin in NODE_BUILTINS {
        let pattern = format!("require(\"{builtin}\")");
        if content.contains(&pattern) {
            return Err(AppError::PluginNotBrowserSafe {
                issue: format!("uses Node builtin {builtin}"),
                file: entry_path.to_string_lossy().into_owned(),
            });
        }
        let pattern2 = format!("require('{builtin}')");
        if content.contains(&pattern2) {
            return Err(AppError::PluginNotBrowserSafe {
                issue: format!("uses Node builtin {builtin}"),
                file: entry_path.to_string_lossy().into_owned(),
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_manifest() {
        let m = parse(r#"{"name":"x","version":"0.1.0","kind":"plugin","permissions":["fs.read"],"entry":"dist/x.js"}"#).unwrap();
        assert_eq!(m.host, "browser");
        assert_eq!(m.permissions.len(), 1);
    }

    #[test]
    fn rejects_bad_kind() {
        let r = parse(r#"{"name":"x","version":"0.1.0","kind":"banana","permissions":["fs.read"],"entry":"x.js"}"#);
        assert!(r.is_err());
    }

    #[test]
    fn rejects_empty_permissions() {
        let r = parse(r#"{"name":"x","version":"0.1.0","kind":"plugin","permissions":[],"entry":"x.js"}"#);
        assert!(r.is_err());
    }
}
```

- [ ] **Step 2: Add manifest error variants**

Append to `error.rs`:
```rust
    #[error("Plugin manifest invalid: {field} — {hint}")]
    InvalidManifest { field: String, hint: String },

    #[error("Plugin code not browser-safe: {issue}")]
    PluginNotBrowserSafe { issue: String, file: String },

    #[error("Plugin hash mismatch — file tampered: {path}")]
    PluginHashMismatch { path: String, expected: String, actual: String },

    #[error("Plugin permission denied: {permission} not in manifest")]
    PluginPermissionDenied { permission: String },
```

- [ ] **Step 3: Run unit tests + commit**

```bash
cd desktop/src-tauri && cargo test services::manifest::tests
git add desktop/src-tauri
git commit -m "feat(desktop): manifest schema + browser-safe verifier via esbuild"
```

---

### Task 1.11: Full plugin_install command

**Files:**
- Modify: `desktop/src-tauri/src/commands/plugin.rs`
- Modify: `desktop/src-tauri/src/services/plugin_install.rs`
- Modify: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- `plugin_install(spec: String) -> AppResult<InstallResult>`
- `InstallResult { id, name, version, manifest: Manifest, path: String, hash: String }`
- Internal: download → parse manifest → verify_browser_safe → write to `<config_dir>/plugins/<id>/` → compute hash → register in SQLite.

- [ ] **Step 1: Implement install pipeline**

Add to `services/plugin_install.rs`:
```rust
use std::path::PathBuf;
use sha2::{Sha256, Digest};
use serde::Serialize;
use crate::services::plugin_registry::PluginRegistry;
use crate::services::manifest::{self, Manifest};

#[derive(Serialize)]
pub struct InstallResult {
    pub id: String,
    pub name: String,
    pub version: String,
    pub manifest: Manifest,
    pub path: String,
    pub hash: String,
}

pub async fn install(
    config_dir: &PathBuf,
    http: &reqwest::Client,
    db: &rusqlite::Connection,
    spec_str: &str,
) -> AppResult<InstallResult> {
    let spec = parse_spec(spec_str)?;
    let (tarball_url, source_desc, source_pkg_name) = match &spec {
        InstallSpec::Npm { name, .. } => {
            let url = npm_tarball_url(name, http).await?;
            (url, format!("npm:{name}"), Some(name.clone()))
        }
        InstallSpec::Git { url, branch } => {
            // Convert github URL to tarball URL
            let url = github_tarball_url(url, branch.as_deref())?;
            (url, spec_str.to_string(), None)
        }
        InstallSpec::Folder { path } => {
            // Skip download; copy local folder
            return install_from_folder(config_dir, db, &PathBuf::from(path)).await;
        }
    };

    let cache_dir = config_dir.join("cache/installs");
    std::fs::create_dir_all(&cache_dir)?;
    let id = format!("plg_{}", short_hash(&tarball_url));
    let target = config_dir.join("plugins").join(&id);
    std::fs::create_dir_all(&target)?;

    let tarball_path = cache_dir.join(format!("{id}.tar.gz"));
    download_to(&tarball_url, &tarball_path, http).await?;
    extract_tarball(&tarball_path, &target)?;

    let manifest_path = target.join("manifest.json");
    let manifest_json = std::fs::read_to_string(&manifest_path)
        .map_err(|e| AppError::InvalidManifest { field: "manifest.json".into(), hint: e.to_string() })?;
    let m = manifest::parse(&manifest_json)?;

    manifest::verify_browser_safe(&target).await?;

    let hash = compute_dir_hash(&target)?;

    let rec = PluginRecord {
        id: id.clone(),
        name: m.name.clone(),
        version: m.version.clone(),
        manifest_json: manifest_json.clone(),
        content_hash: hash.clone(),
        installed_at: now_unix(),
        source: source_desc.clone(),
        enabled: true,
    };
    PluginRegistry::new(db).insert(&rec)?;

    Ok(InstallResult {
        id, name: m.name, version: m.version,
        manifest: m, path: target.to_string_lossy().into_owned(), hash,
    })
}
```

Plus helper functions: `github_tarball_url`, `download_to`, `extract_tarball`, `compute_dir_hash`, `short_hash`, `now_unix`, `install_from_folder`.

- [ ] **Step 2: Wire command**

In `commands/plugin.rs`:
```rust
use tauri::State;
use crate::state::SharedState;
use crate::error::AppResult;
use crate::services::plugin_install::{self, InstallResult};

#[tauri::command]
pub async fn plugin_install(
    spec: String,
    state: State<'_, SharedState>,
) -> AppResult<InstallResult> {
    let s = state.read();
    plugin_install::install(&s.config_dir, &s.http, &s.db, &spec).await
}
```

- [ ] **Step 3: Register command + capability**

Add to `commands/mod.rs`: `pub mod plugin;`
Add to `capabilities/default.json`: `"plugin:allow-install"`.
Register in `generate_handler!`.

- [ ] **Step 4: Add deps**

In `Cargo.toml`:
```toml
sha2 = "0.10"
tar = "0.4"
flate2 = "1"
```

- [ ] **Step 5: Manual e2e smoke**

Create a tiny test plugin in `/tmp/test-plugin/`:
```
/tmp/test-plugin/
├── manifest.json
└── dist/plugin.js
```

`manifest.json`:
```json
{"name":"test","version":"0.1.0","kind":"plugin","permissions":["fs.read"],"entry":"dist/plugin.js"}
```

`dist/plugin.js`:
```js
export default {
  apply(ctx) { ctx.logger.info('test plugin loaded') }
}
```

Then in app:
```js
await window.__TAURI__.core.invoke('plugin_install', { spec: 'folder:/tmp/test-plugin' })
```

Expected: returns InstallResult, manifest.json + dist/ copied to `<config>/plugins/plg_xxx/`.

- [ ] **Step 6: Commit**

```bash
cd desktop/src-tauri && cargo build
git add desktop/src-tauri
git commit -m "feat(desktop): full plugin_install pipeline (download/parse/verify/hash/register)"
```

---

### Task 1.12: Plugin list / read_file / get_manifest commands

**Files:**
- Modify: `desktop/src-tauri/src/commands/plugin.rs`

**Interfaces:**
- `plugin_list() -> AppResult<Vec<PluginInfo>>` — `{ id, name, version, manifest, enabled }`
- `plugin_read_file(id: String, file: String) -> AppResult<Vec<u8>>` — validates path is within `<config>/plugins/<id>/` AND hash matches SQLite record.
- `plugin_get_manifest(id: String) -> AppResult<Manifest>`
- `plugin_uninstall(id: String) -> AppResult<()>` — backup then delete
- `plugin_reload(id: String) -> AppResult<()>`

- [ ] **Step 1: Write plugin_read_file with hash check**

```rust
use std::path::PathBuf;

#[tauri::command]
pub fn plugin_read_file(
    id: String,
    file: String,
    state: State<'_, SharedState>,
) -> AppResult<Vec<u8>> {
    let s = state.read();
    let reg = crate::services::plugin_registry::PluginRegistry::new(&s.db);
    let rec = reg.get(&id)?.ok_or_else(|| AppError::Internal { message: format!("plugin not found: {id}") })?;
    let plugin_dir = s.config_dir.join("plugins").join(&id);
    let file_path = plugin_dir.join(&file);

    // Path traversal check
    if !file_path.starts_with(&plugin_dir) {
        return Err(AppError::PermissionDenied { cmd: format!("plugin_read_file:{file}") });
    }

    let bytes = std::fs::read(&file_path).map_err(|e| AppError::FsIo { message: e.to_string() })?;
    let actual = sha2::Sha256::digest(&bytes);
    let actual_hex = format!("{:x}", actual);

    // Hash check covers only files in dist/
    if file.starts_with("dist/") {
        // Compute hash of full dist/ dir to compare
        let full = crate::services::plugin_install::compute_dir_hash(&plugin_dir)?;
        if full != rec.content_hash {
            return Err(AppError::PluginHashMismatch {
                path: file_path.to_string_lossy().into_owned(),
                expected: rec.content_hash,
                actual: actual_hex,
            });
        }
    }

    Ok(bytes)
}
```

- [ ] **Step 2: Write other commands**

```rust
#[tauri::command]
pub fn plugin_list(state: State<'_, SharedState>) -> AppResult<Vec<crate::services::plugin_registry::PluginRecord>> {
    let s = state.read();
    crate::services::plugin_registry::PluginRegistry::new(&s.db).list().map_err(AppError::from)
}

#[tauri::command]
pub fn plugin_get_manifest(id: String, state: State<'_, SharedState>) -> AppResult<crate::services::manifest::Manifest> {
    let s = state.read();
    let reg = crate::services::plugin_registry::PluginRegistry::new(&s.db);
    let rec = reg.get(&id)?.ok_or_else(|| AppError::Internal { message: format!("plugin not found: {id}") })?;
    crate::services::manifest::parse(&rec.manifest_json)
}

#[tauri::command]
pub fn plugin_uninstall(id: String, state: State<'_, SharedState>) -> AppResult<()> {
    let s = state.read();
    let plugin_dir = s.config_dir.join("plugins").join(&id);
    if plugin_dir.exists() {
        // backup
        let backup_dir = s.config_dir.join("plugin-backups").join(format!("{id}__{}", now_unix()));
        std::fs::create_dir_all(&backup_dir)?;
        copy_dir_recursive(&plugin_dir, &backup_dir)?;
        std::fs::remove_dir_all(&plugin_dir)?;
    }
    crate::services::plugin_registry::PluginRegistry::new(&s.db).delete(&id)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_reload(id: String, _state: State<'_, SharedState>) -> AppResult<()> {
    // Phase 1: no-op (Phase 2: emit WebView2 event)
    Ok(())
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest_path = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), dest_path)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Register commands + commit**

```bash
cd desktop/src-tauri && cargo build
git add desktop/src-tauri
git commit -m "feat(desktop): plugin_list/read_file/get_manifest/uninstall/reload commands"
```

---

### Task 1.13: WebView2 dsh/host.ts boots cordis

**Files:**
- Create: `apps/web/src/dsh/host.ts`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Set up vite + react skeleton in apps/web**

```bash
cd apps/web
pnpm init
pnpm add react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

- [ ] **Step 2: Create dsh/host.ts**

Write `apps/web/src/dsh/host.ts`:
```typescript
import { initLoader, Loader } from '@dsh/loader'
import { Context } from '@dsh/cordis'

export interface Host {
  ctx: Context
  loader: Loader
}

export async function startHost(): Promise<Host> {
  const loader = new Loader()
  initLoader(loader)

  const ctx = new Context()
  ctx.plugin(loader)

  // Browser-side plugin system (no-op for now; populated by S4)
  loader.internal = {
    version: 'browser',
    loadCache: new Map(),
    import: async (specifier: string) => {
      const id = specifier.replace(/[^a-zA-Z0-9]/g, '_')
      const url = `/plugins/${id}.js`
      return await import(/* @vite-ignore */ url)
    },
    registerStatic: () => {},
    prefetch: async () => {},
    invalidate: () => {},
  }

  return { ctx, loader }
}
```

- [ ] **Step 3: Wire to main.tsx**

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { startHost } from './dsh/host'

async function main() {
  await startHost()
  // Render UI (placeholder for Phase 1)
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  root.render(<h1>DSH Runtime — Phase 1</h1>)
}

main().catch(console.error)
```

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): dsh host boots cordis in WebView2"
```

---

### Task 1.14: TanStack Query + bridge layer

**Files:**
- Create: `apps/web/src/dsh/bridge/credentials.ts`
- Create: `apps/web/src/dsh/bridge/fs.ts`
- Create: `apps/web/src/dsh/bridge/settings.ts`
- Create: `apps/web/src/dsh/bridge/plugin.ts`
- Create: `apps/web/src/dsh/bridge/app.ts`
- Create: `apps/web/src/dsh/bridge/index.ts`
- Create: `apps/web/src/dsh/query/client.ts`
- Create: `apps/web/src/dsh/query/queries.ts`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Write bridge files**

`apps/web/src/dsh/bridge/app.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core'

export const appApi = {
  version: () => invoke<string>('app_version'),
  crashLogPath: () => invoke<string>('crash_log_path'),
}
```

`apps/web/src/dsh/bridge/settings.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core'

export const settingsApi = {
  get: <T = unknown>(key: string) => invoke<T | null>('settings_get', { key }),
  update: <T = unknown>(key: string, value: T) =>
    invoke<void>('settings_update', { key, value }),
}
```

`apps/web/src/dsh/bridge/credentials.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core'

export const credentialsApi = {
  get: (key: string) => invoke<string | null>('credentials_get', { key }),
  set: (key: string, value: string) =>
    invoke<void>('credentials_set', { key, value }),
  delete: (key: string) => invoke<void>('credentials_delete', { key }),
}
```

`apps/web/src/dsh/bridge/fs.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core'

interface FsEntry { name: string; is_dir: boolean; size: number }

export const fsApi = {
  read: (path: string) => invoke<number[]>('fs_read', { path }),
  write: (path: string, content: number[]) =>
    invoke<void>('fs_write', { path, content }),
  list: (dir: string) => invoke<FsEntry[]>('fs_list', { dir }),
  exists: (path: string) => invoke<boolean>('fs_exists', { path }),
}
```

`apps/web/src/dsh/bridge/plugin.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core'

export interface Manifest {
  name: string
  version: string
  kind: 'plugin' | 'skill' | 'mcp' | 'agent'
  platforms?: Record<string, string>
  host: 'browser' | 'node'
  permissions: string[]
  entry: string
  client?: string
}

export interface InstallResult {
  id: string
  name: string
  version: string
  manifest: Manifest
  path: string
  hash: string
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  manifest_json: string
  content_hash: string
  installed_at: number
  source: string
  enabled: boolean
}

export const pluginApi = {
  install: (spec: string) => invoke<InstallResult>('plugin_install', { spec }),
  uninstall: (id: string) => invoke<void>('plugin_uninstall', { id }),
  reload: (id: string) => invoke<void>('plugin_reload', { id }),
  list: () => invoke<PluginInfo[]>('plugin_list'),
  readFile: (id: string, file: string) =>
    invoke<number[]>('plugin_read_file', { id, file }),
  getManifest: (id: string) => invoke<Manifest>('plugin_get_manifest', { id }),
}
```

`apps/web/src/dsh/bridge/index.ts`:
```typescript
export * from './app'
export * from './settings'
export * from './credentials'
export * from './fs'
export * from './plugin'
```

- [ ] **Step 2: Write query layer**

`apps/web/src/dsh/query/client.ts`:
```typescript
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})
```

`apps/web/src/dsh/query/queries.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pluginApi, settingsApi, appApi } from '../bridge'

export const useAppVersion = () =>
  useQuery({ queryKey: ['app', 'version'], queryFn: appApi.version })

export const useInstalledPlugins = () =>
  useQuery({
    queryKey: ['plugins'],
    queryFn: pluginApi.list,
    staleTime: Infinity,
  })

export function useInstallPlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (spec: string) => pluginApi.install(spec),
    onSettled: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function useUninstallPlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => pluginApi.uninstall(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function useSettings<T = unknown>(key: string) {
  return useQuery({
    queryKey: ['settings', key],
    queryFn: () => settingsApi.get<T>(key),
  })
}

export function useUpdateSettings<T = unknown>(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (value: T) => settingsApi.update(key, value),
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings', key] }),
  })
}
```

- [ ] **Step 3: Wire QueryClientProvider in main.tsx**

```typescript
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './dsh/query/client'

async function main() {
  await startHost()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): bridge layer + TanStack Query"
```

---

### Task 1.15: Phase 1 demo — install one plugin and load it

**Files:**
- Create: `apps/web/src/routes/Plugins.tsx`
- Create: `apps/web/src/routes/PluginInstallDialog.tsx`

- [ ] **Step 1: Write Plugins route**

```typescript
import { useInstalledPlugins, useInstallPlugin } from '../dsh/query/queries'

export function Plugins() {
  const { data: plugins } = useInstalledPlugins()
  const install = useInstallPlugin()

  return (
    <div className="p-4">
      <h1>Plugins</h1>
      <button onClick={() => install.mutate('folder:/tmp/test-plugin')}>
        Install test plugin
      </button>
      <ul>
        {plugins?.map(p => (
          <li key={p.id}>{p.name} v{p.version}</li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Wire into App**

```typescript
function App() {
  return <Plugins />
}
```

- [ ] **Step 3: Manual smoke test**

Build, run, click "Install test plugin" → confirm SQLite has row, `<config>/plugins/plg_xxx/` exists.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): plugins route + install button (Phase 1 demo)"
```

---

### Task 1.16: Phase 1 CI gate

**Files:**
- Create: `.github/workflows/ci-phase1.yml`

- [ ] **Step 1: Write CI workflow**

```yaml
name: CI Phase 1
on: [push, pull_request]
jobs:
  rust:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cd desktop/src-tauri && cargo fmt --check
      - run: cd desktop/src-tauri && cargo clippy --all-targets -- -D warnings
      - run: cd desktop/src-tauri && cargo test --workspace
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: cd apps/web && pnpm tsc --noEmit
      - run: cd apps/web && pnpm test
```

- [ ] **Step 2: Commit + verify**

```bash
git add .github
git commit -m "ci: phase 1 gate (Rust + web typecheck/tests)"
```

---

## PHASE 2 — Ecosystem

(Slices S5, S6, S7. After Phase 1 demo works.)

> **Out of scope for this document** (plan is already 16 tasks; Phase 2 will have its own plan file or be appended below in a future edit.)

---

## PHASE 3 — Ship

(Slices S8, S9, S10, S11. After Phase 2 ecosystem stable.)

> **Out of scope for this document** — appended in a future edit.

---

## Self-Review (run after writing)

1. **Spec coverage** (against spec sections):
   - §3 architecture (4 layers) → Tasks 1.1-1.7 establish layers 4 & 3; Tasks 1.13-1.15 establish layer 2; S4 covers layer 1.
   - §5 components (commands listed) → Tasks 1.2-1.12 cover all commands.
   - §6.1 plugin install flow → Task 1.11.
   - §6.3 inventory toggle → deferred to Phase 2 (S5).
   - §7 cross-platform paths → Task 1.5 uses `PathBuf`; Task 1.7 shell uses PathBuf; Cargo deps on `url`.
   - §8 plugin contract → Tasks 1.9-1.11 manifest format.
   - §9 ~140 plugins migration → Phase 2 (out of scope here).
   - §10 testing → Task 1.16 CI gate. Detailed E2E deferred to Phase 3.
   - §11 decisions → Distributed across Phase 1 (1 command skeleton, etc.).
   - §12 risk → Documented in spec; mitigation in tasks.

2. **Placeholder scan**: No "TBD", "TODO", "implement later". Helper functions `copy_dir_recursive`, `now_unix`, `short_hash`, `extract_tarball`, `download_to`, `compute_dir_hash`, `github_tarball_url` need full implementations in Task 1.11 — flagged inline as needing helper bodies.

3. **Type consistency**: `AppState.config_dir: PathBuf` consistently used. `SharedState = Arc<RwLock<AppState>>` used everywhere. Manifest struct matches between `manifest.rs` and `bridge/plugin.ts`.

## Open Items (flagged for engineer)

- Task 1.11 helper bodies (`copy_dir_recursive`, `now_unix`, `short_hash`, `extract_tarball`, `download_to`, `compute_dir_hash`, `github_tarball_url`) — provide full implementations in code review or follow-up.
- `tauri.conf.json` icon paths reference `icons/*.png`, `icons/*.icns`, `icons/*.ico` — engineer must generate these from a source asset.
- WiX template `wix/per-user-main.wxs` — may need to copy/adapt from old `desktop/src-tauri/wix/` if it existed; otherwise use Tauri default.
- Phase 2 / Phase 3 task definitions are intentionally stubbed (out of scope for this plan edit). Run writing-plans again after Phase 1 ships.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-dsh-client-architecture-refactor.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. Best for parallel/independent work.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?