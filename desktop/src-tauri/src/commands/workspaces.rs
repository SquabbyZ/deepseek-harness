//! Workspace registry reads from the DSH CLI's `~/.dsh/storages/workspace.json`,
//! so the desktop shows the user's real workspaces/sessions instead of a
//! fixture placeholder.

use serde::Deserialize;
use std::collections::HashMap;

use crate::error::{AppError, AppResult};
use crate::services::dsh_settings::dsh_home_dir;

#[derive(Deserialize)]
struct WorkspaceFile {
    #[serde(default)]
    tables: Tables,
}
#[derive(Default, Deserialize)]
struct Tables {
    #[serde(default)]
    workspaces: HashMap<String, WorkspaceRow>,
}
#[derive(Deserialize)]
struct WorkspaceRow {
    #[serde(default)]
    path: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    sessionIds: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct WorkspaceInfo {
    pub workspaceId: String,
    pub path: String,
    pub title: String,
    pub sessionIds: Vec<String>,
}

/** Read the real workspace registry from `~/.dsh/storages/workspace.json`. */
#[tauri::command]
pub fn dsh_read_workspaces() -> AppResult<Vec<WorkspaceInfo>> {
    let path = dsh_home_dir().join("storages/workspace.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| AppError::Internal {
        message: format!("read {}: {e}", path.display()),
    })?;
    let file: WorkspaceFile = serde_json::from_str(&text).map_err(|e| AppError::Internal {
        message: format!("parse {}: {e}", path.display()),
    })?;
    let mut out: Vec<WorkspaceInfo> = file.tables.workspaces
        .into_iter()
        .map(|(id, row)| {
            let title = if row.title.is_empty() { id.clone() } else { row.title };
            WorkspaceInfo {
                workspaceId: id,
                path: row.path,
                title,
                sessionIds: row.sessionIds,
            }
        })
        .collect();
    out.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(out)
}
