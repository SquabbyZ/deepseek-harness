use crate::error::AppResult;
use crate::services::fs::{self, FsEntry};
use crate::state::SharedState;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn fs_read(path: String, state: State<'_, SharedState>) -> AppResult<Vec<u8>> {
    let s = state.read();
    fs::read(&s.config_dir, &PathBuf::from(path))
}

#[tauri::command]
pub fn fs_write(
    path: String,
    content: Vec<u8>,
    state: State<'_, SharedState>,
) -> AppResult<()> {
    let s = state.read();
    fs::write(&s.config_dir, &PathBuf::from(path), &content)
}

#[tauri::command]
pub fn fs_list(dir: String, state: State<'_, SharedState>) -> AppResult<Vec<FsEntry>> {
    let s = state.read();
    fs::list(&s.config_dir, &PathBuf::from(dir))
}

#[tauri::command]
pub fn fs_exists(path: String, state: State<'_, SharedState>) -> AppResult<bool> {
    let s = state.read();
    Ok(fs::exists(&s.config_dir, &PathBuf::from(path)))
}