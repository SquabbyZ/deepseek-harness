use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use sha2::Digest;

use crate::error::{AppError, AppResult};
use crate::services::manifest::{self, Manifest};
use crate::services::plugin_install::{self, compute_dir_hash, now_unix, InstallResult};
use crate::services::plugin_registry::{PluginRecord, PluginRegistry};
use crate::state::SharedState;

/// Renderer-facing view of an installed plugin. Excludes the raw
/// `manifest_json` / `content_hash` / `installed_at` / `source` fields
/// (those are host-internal) and exposes the parsed manifest instead.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub manifest: Manifest,
    pub enabled: bool,
}

impl PluginInfo {
    fn from_record(rec: &PluginRecord) -> AppResult<Self> {
        let manifest = manifest::parse(&rec.manifest_json)?;
        Ok(PluginInfo {
            id: rec.id.clone(),
            name: rec.name.clone(),
            version: rec.version.clone(),
            manifest,
            enabled: rec.enabled,
        })
    }
}

#[tauri::command]
pub fn plugin_list(state: State<'_, SharedState>) -> AppResult<Vec<PluginInfo>> {
    let db: Arc<std::sync::Mutex<rusqlite::Connection>> = {
        let s = state.read();
        Arc::clone(&s.db)
    };
    let guard = db.lock().expect("db mutex poisoned");
    let reg = PluginRegistry::new(&*guard);
    let records = reg.list()?;
    let mut out = Vec::with_capacity(records.len());
    for rec in &records {
        out.push(PluginInfo::from_record(rec)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn plugin_read_file(
    id: String,
    file: String,
    state: State<'_, SharedState>,
) -> AppResult<Vec<u8>> {
    // Pull config_dir + plugin record out of shared state without holding
    // the read lock across the db mutex acquisition.
    let (config_dir, rec) = {
        let s = state.read();
        let db: Arc<std::sync::Mutex<rusqlite::Connection>> = Arc::clone(&s.db);
        drop(s);
        let guard = db.lock().expect("db mutex poisoned");
        let reg = PluginRegistry::new(&*guard);
        let rec = reg.get(&id)?.ok_or_else(|| AppError::Internal {
            message: format!("plugin not found: {id}"),
        })?;
        // Need config_dir too, but it lives on the same lock — re-borrow.
        let s = state.read();
        let dir = s.config_dir.clone();
        drop(s);
        (dir, rec)
    };

    let plugin_dir = config_dir.join("plugins").join(&id);
    let file_path = plugin_dir.join(&file);

    // Path traversal check: resolved path must live inside plugin_dir.
    if !file_path.starts_with(&plugin_dir) {
        return Err(AppError::PermissionDenied {
            cmd: format!("plugin_read_file:{file}"),
        });
    }

    let bytes = std::fs::read(&file_path).map_err(|e| AppError::FsIo {
        message: e.to_string(),
    })?;
    let actual_hex = format!("{:x}", sha2::Sha256::digest(&bytes));

    // Hash check covers only files under dist/. The registry's content_hash
    // is computed over the whole plugin dir, so we recompute and compare.
    // Files outside dist/ (e.g. manifest.json) are not gated on hash here.
    if file.starts_with("dist/") {
        let full = compute_dir_hash(&plugin_dir)?;
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

#[tauri::command]
pub fn plugin_get_manifest(id: String, state: State<'_, SharedState>) -> AppResult<Manifest> {
    let db: Arc<std::sync::Mutex<rusqlite::Connection>> = {
        let s = state.read();
        Arc::clone(&s.db)
    };
    let guard = db.lock().expect("db mutex poisoned");
    let reg = PluginRegistry::new(&*guard);
    let rec = reg.get(&id)?.ok_or_else(|| AppError::Internal {
        message: format!("plugin not found: {id}"),
    })?;
    manifest::parse(&rec.manifest_json)
}

#[tauri::command]
pub fn plugin_uninstall(id: String, state: State<'_, SharedState>) -> AppResult<()> {
    let (config_dir, db) = {
        let s = state.read();
        (s.config_dir.clone(), Arc::clone(&s.db))
    };
    let plugin_dir = config_dir.join("plugins").join(&id);

    if plugin_dir.exists() {
        // Backup the plugin tree before deleting. Backup dir name is
        // `<id>__<unix_ts>` so multiple backups of the same id
        // accumulate rather than overwrite each other.
        let backup_dir = config_dir
            .join("plugin-backups")
            .join(format!("{id}__{}", now_unix()));
        std::fs::create_dir_all(&backup_dir)?;
        copy_dir_recursive(&plugin_dir, &backup_dir)?;
        std::fs::remove_dir_all(&plugin_dir)?;
    }

    let conn = db.lock().expect("db mutex poisoned");
    PluginRegistry::new(&*conn).delete(&id)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_reload(_id: String, _state: State<'_, SharedState>) -> AppResult<()> {
    // Phase 1: no-op stub. Phase 2 will emit a WebView2 event to refresh
    // the running plugin context.
    Ok(())
}

#[tauri::command]
pub async fn plugin_install(
    spec: String,
    state: State<'_, SharedState>,
) -> AppResult<InstallResult> {
    // Take shared borrows of the http client and db; release before any
    // await so we don't hold the state lock for the duration.
    let (config_dir, http, db) = {
        let s = state.read();
        (s.config_dir.clone(), Arc::clone(&s.http), Arc::clone(&s.db))
    };
    plugin_install::install(&config_dir, &http, &db, &spec).await
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> AppResult<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_symlink() {
            // Skip symlinks to avoid escaping the source tree.
            continue;
        } else if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
            std::fs::copy(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest_json() -> String {
        r#"{"name":"p","version":"0.1.0","kind":"plugin","permissions":["fs.read"],"entry":"dist/p.js"}"#
            .to_string()
    }

    fn sample_record(id: &str) -> PluginRecord {
        PluginRecord {
            id: id.to_string(),
            name: "p".into(),
            version: "0.1.0".into(),
            manifest_json: sample_manifest_json(),
            content_hash: "deadbeef".into(),
            installed_at: 0,
            source: "npm:p".into(),
            enabled: true,
        }
    }

    #[test]
    fn plugin_info_from_record_parses_manifest() {
        let info = PluginInfo::from_record(&sample_record("plg_x")).unwrap();
        assert_eq!(info.id, "plg_x");
        assert_eq!(info.name, "p");
        assert_eq!(info.version, "0.1.0");
        assert_eq!(info.manifest.kind, "plugin");
        assert!(info.enabled);
    }

    #[test]
    fn plugin_info_from_record_errors_on_bad_manifest() {
        let mut rec = sample_record("plg_x");
        rec.manifest_json = "{not json".into();
        assert!(PluginInfo::from_record(&rec).is_err());
    }

    #[test]
    fn copy_dir_recursive_copies_files_and_subdirs() {
        let tag = plugin_install::short_hash("cmd_copy_test");
        let src = std::env::temp_dir().join(format!("dsh_cmd_src_{tag}"));
        let dst = std::env::temp_dir().join(format!("dsh_cmd_dst_{tag}"));
        let _ = std::fs::remove_dir_all(&src);
        let _ = std::fs::remove_dir_all(&dst);

        std::fs::create_dir_all(src.join("nested")).unwrap();
        std::fs::write(src.join("a.txt"), b"alpha").unwrap();
        std::fs::write(src.join("nested").join("b.txt"), b"beta").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert_eq!(std::fs::read(dst.join("a.txt")).unwrap(), b"alpha");
        assert_eq!(
            std::fs::read(dst.join("nested").join("b.txt")).unwrap(),
            b"beta"
        );

        std::fs::remove_dir_all(&src).ok();
        std::fs::remove_dir_all(&dst).ok();
    }
}