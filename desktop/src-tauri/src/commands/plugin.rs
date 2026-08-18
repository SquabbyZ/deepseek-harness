use std::sync::Arc;
use tauri::State;

use crate::error::AppResult;
use crate::services::plugin_install::{self, InstallResult};
use crate::services::plugin_registry::{PluginRecord, PluginRegistry};
use crate::state::SharedState;

#[tauri::command]
pub fn plugin_list(state: State<'_, SharedState>) -> AppResult<Vec<PluginRecord>> {
    let s = state.read();
    let db: Arc<std::sync::Mutex<rusqlite::Connection>> = Arc::clone(&s.db);
    drop(s);
    let guard = db.lock().expect("db mutex poisoned");
    let reg = PluginRegistry::new(&*guard);
    Ok(reg.list()?)
}

#[tauri::command]
pub fn plugin_read_file(
    id: String,
    _path: String,
    _state: State<'_, SharedState>,
) -> AppResult<Vec<u8>> {
    // Skeleton: full implementation in the next task (plugin install/uninstall).
    // Returns empty body for now; the real wiring will read installed plugin
    // files under the resolved plugin directory.
    let _ = id;
    Ok(Vec::new())
}

#[tauri::command]
pub fn plugin_get_manifest(
    id: String,
    state: State<'_, SharedState>,
) -> AppResult<Option<PluginRecord>> {
    let s = state.read();
    let db: Arc<std::sync::Mutex<rusqlite::Connection>> = Arc::clone(&s.db);
    drop(s);
    let guard = db.lock().expect("db mutex poisoned");
    let reg = PluginRegistry::new(&*guard);
    Ok(reg.get(&id)?)
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