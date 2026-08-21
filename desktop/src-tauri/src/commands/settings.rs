use tauri::State;
use serde_json::Value;
use crate::state::SharedState;
use crate::error::{AppError, AppResult};
use crate::services::dsh_settings::DshSettingsFile;

#[tauri::command]
pub fn settings_get(key: String, state: State<'_, SharedState>) -> AppResult<Option<Value>> {
    let s = state.read();
    let file = DshSettingsFile::new(s.dsh_home.join("settings.yaml"));
    let value = file.get_namespace(&key);
    Ok(if value.is_null() { None } else { Some(value) })
}

#[tauri::command]
pub fn settings_update(key: String, value: Value, state: State<'_, SharedState>) -> AppResult<()> {
    let s = state.read();
    let file = DshSettingsFile::new(s.dsh_home.join("settings.yaml"));
    file.set_namespace(&key, &value).map_err(|e| AppError::Internal { message: format!("settings_update({key}): {e}") })
}

/** The DSH home directory (`~/.dsh`) — the settings panel's 打开配置文件 target. */
#[tauri::command]
pub fn dsh_config_dir(state: State<'_, SharedState>) -> AppResult<String> {
    let s = state.read();
    Ok(s.dsh_home.to_string_lossy().into_owned())
}
