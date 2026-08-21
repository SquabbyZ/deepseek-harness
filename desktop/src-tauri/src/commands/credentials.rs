use std::collections::HashMap;

use crate::error::AppResult;
use crate::services::credentials;
use crate::services::dsh_settings::dsh_home_dir;

#[tauri::command]
pub fn credentials_get(key: String) -> AppResult<Option<String>> { credentials::get(&key) }

/**
 * The DSH CLI's `~/.dsh/.credentials.yaml` key/value map, so the desktop shares
 * the CLI's credentials (not just the OS keyring). Simple `REF: "value"` lines.
 */
#[tauri::command]
pub fn dsh_read_credentials() -> AppResult<HashMap<String, String>> {
    let path = dsh_home_dir().join(".credentials.yaml");
    let mut out = HashMap::new();
    if !path.exists() {
        return Ok(out);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| crate::error::AppError::Internal {
        message: format!("read {}: {e}", path.display()),
    })?;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(colon) = trimmed.find(':') else { continue };
        let key = trimmed[..colon].trim().to_string();
        let mut value = trimmed[colon + 1..].trim().to_string();
        if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            value = value[1..value.len() - 1].to_string();
        }
        if !key.is_empty() && !value.is_empty() {
            out.insert(key, value);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn credentials_set(key: String, value: String) -> AppResult<()> {
    credentials::set(&key, &value)
}

#[tauri::command]
pub fn credentials_delete(key: String) -> AppResult<()> {
    credentials::delete(&key)
}
