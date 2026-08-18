use crate::error::{AppError, AppResult};
use crate::services::platform;
use crate::state::SharedState;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::State;

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
    let child = cmd
        .spawn()
        .map_err(|e| AppError::Shell { message: e.to_string() })?;
    // `Child::id()` is `u32` on Windows and `u32` on Unix too in std; widen to u64.
    Ok(child.id().map(u64::from).unwrap_or(0))
}