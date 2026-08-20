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

/// Tauri command that returns the resolved per-OS app config directory
/// (e.g. `%APPDATA%/ai.deepseek.harness.desktop` on Windows,
/// `~/Library/Application Support/ai.deepseek.harness.desktop` on macOS).
/// Spec §7.1 mandates that web-side path resolution go through Tauri; the
/// returned path is the canonical `$DSH_HOME` equivalent on desktop and
/// replaces the legacy Node `os.homedir()` + `.dsh` fallback for in-box
/// plugins that need a host home in the WebView2 runtime.
#[tauri::command]
pub fn app_config_dir(state: State<'_, SharedState>) -> AppResult<String> {
    let s = state.read();
    Ok(s.config_dir.to_string_lossy().into_owned())
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