use tauri::State;

use crate::error::AppResult;
use crate::services::plugin_registry::PluginRegistry;
use crate::state::SharedState;

#[tauri::command]
pub fn inventory_set_enabled(
    id: String,
    enabled: bool,
    state: State<'_, SharedState>,
) -> AppResult<()> {
    let db = {
        let s = state.read();
        s.db.clone()
    };
    let conn = db.lock().expect("db mutex poisoned");
    PluginRegistry::new(&*conn).update_enabled(&id, enabled)?;
    Ok(())
}
