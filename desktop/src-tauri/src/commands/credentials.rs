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
