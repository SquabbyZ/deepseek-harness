use tauri::State;
use serde_json::Value;
use crate::state::SharedState;
use crate::error::{AppError, AppResult};
use crate::services::settings::SettingsStore;

#[tauri::command]
pub fn settings_get(key: String, state: State<'_, SharedState>) -> AppResult<Option<Value>> {
    let s = state.read();
    let conn = s.db.lock().expect("db mutex poisoned");
    SettingsStore::new(&*conn).get(&key).map_err(AppError::from)
}

#[tauri::command]
pub fn settings_update(key: String, value: Value, state: State<'_, SharedState>) -> AppResult<()> {
    let s = state.read();
    let conn = s.db.lock().expect("db mutex poisoned");
    SettingsStore::new(&*conn).set(&key, &value).map_err(AppError::from)
}
