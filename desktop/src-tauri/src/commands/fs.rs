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

/// Resolve `path` against the host's launch directory (when relative) and
/// validate that the result names an existing, searchable directory.
///
/// The browser-side renderer cannot `stat` a path — only the host has the
/// filesystem. Phase 2 Task 2.7.2 wires this command into
/// `packages/subagent/subagent-acp`'s `bridge.cwdApi.resolve` so the cwd
/// validation that used to live in `node:fs` can run inside WebView2. A
/// relative `path` is re-anchored to `std::env::current_dir()` (the launch
/// directory), mirroring `node:path::resolve` for absolute-or-relative input.
///
/// Returns the canonical absolute path on success; on failure, an
/// `AppError::FsIo` carrying a stable diagnostic. POSIX additionally enforces
/// the directory search bit (`S_IXUSR | S_IXGRP | S_IXOTH`) — the same check
/// `node:fs::accessSync(X_OK)` performs — because a mode-600 directory is
/// `is_dir()` but unusable as a subprocess cwd.
#[tauri::command]
pub fn cwd_resolve(path: String) -> AppResult<String> {
    let raw = PathBuf::from(&path);
    let absolute = if raw.is_absolute() {
        raw
    } else {
        std::env::current_dir()
            .map_err(|e| crate::error::AppError::FsIo { message: format!("current_dir: {e}") })?
            .join(&raw)
    };
    let metadata = std::fs::metadata(&absolute).map_err(|e| crate::error::AppError::FsIo {
        message: format!("{}: {e}", absolute.display()),
    })?;
    if !metadata.is_dir() {
        return Err(crate::error::AppError::FsIo {
            message: format!("{}: not a directory", absolute.display()),
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Mirror `node:fs::accessSync(path, X_OK)`: a subprocess cwd needs
        // SEARCH permission on at least one of user/group/other. is_dir() is
        // true for a mode-600 directory but spawn would fail EACCES.
        let mode = metadata.permissions().mode();
        if mode & 0o111 == 0 {
            return Err(crate::error::AppError::FsIo {
                message: format!("{}: not searchable (X_OK)", absolute.display()),
            });
        }
    }
    // Canonicalize so a symlinked parent (macOS /tmp → /private/tmp) reports
    // the same path the child will see in its real `process.cwd()`. A failed
    // canonicalize is not fatal (the metadata check already proved the path
    // exists); fall back to the joined path in that case.
    let resolved = absolute.canonicalize().unwrap_or(absolute);
    Ok(resolved.to_string_lossy().into_owned())
}