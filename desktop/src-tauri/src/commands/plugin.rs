use std::sync::Arc;
use tauri::State;

use crate::error::AppResult;
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
