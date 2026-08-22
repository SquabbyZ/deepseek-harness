use crate::error::{AppError, AppResult};
use crate::services::fs::{self, FsEntry};
use crate::state::SharedState;
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub fn fs_read(path: String, state: State<'_, SharedState>) -> AppResult<Vec<u8>> {
    let s = state.read();
    fs::read(&s.config_dir, &s.dsh_home, &PathBuf::from(path))
}

#[tauri::command]
pub fn fs_write(
    path: String,
    content: Vec<u8>,
    state: State<'_, SharedState>,
) -> AppResult<()> {
    let s = state.read();
    fs::write(&s.config_dir, &s.dsh_home, &PathBuf::from(path), &content)
}

#[tauri::command]
pub fn fs_list(dir: String, state: State<'_, SharedState>) -> AppResult<Vec<FsEntry>> {
    let s = state.read();
    fs::list(&s.config_dir, &s.dsh_home, &PathBuf::from(dir))
}

#[tauri::command]
pub fn fs_exists(path: String, state: State<'_, SharedState>) -> AppResult<bool> {
    let s = state.read();
    Ok(fs::exists(&s.config_dir, &s.dsh_home, &PathBuf::from(path)))
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

/**
 * Ensure the skill aggregation root exists and links every `~/.agents/skills`
 * skill into it.
 *
 * The 技能管理 inventory reads a SINGLE root — `~/.dsh/skills` — which is the
 * real source of truth. Skills installed by DSH land there directly, while the
 * `~/.agents` skills (the Claude-Code agent root the user may also keep) are
 * aggregated in by linking each `~/.agents/skills/<name>` directory under
 * `~/.dsh/skills/<name>`. Linking (not copying) keeps one physical copy: edits
 * in either location are the same files.
 *
 * Windows uses directory junctions (`mklink /J`, no admin rights); POSIX uses
 * symlinks. A link whose target already exists is skipped; a name collision
 * (a real `~/.dsh/skills/<name>` that is not a link to the agent root) is left
 * alone so the user's own skill wins.
 *
 * The browser calls this lazily before the first `skillInventory/list` read.
 */
/**
 * Core of `skill_roots_ensure`, factored out so the linking behavior is
 * unit-testable without a Tauri runtime. Returns the list of link failures
 * (empty on success).
 */
fn ensure_skill_roots(dsh_home: &Path, agents_home: &Path) -> Vec<String> {
    let skills_root = dsh_home.join("skills");
    let agents_skills = agents_home.join("skills");

    // 1. Ensure the aggregation root exists.
    if let Err(e) = std::fs::create_dir_all(&skills_root) {
        return vec![format!("{}: {e}", skills_root.display())];
    }

    // 2. If ~/.agents/skills is absent, nothing to aggregate.
    let Ok(entries) = std::fs::read_dir(&agents_skills) else {
        return Vec::new();
    };

    let mut failures: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let target = entry.path();
        let link = skills_root.join(&name);

        // Skip if the link target already exists — either an existing junction
        // (idempotent re-run) or a real user-created skill that wins.
        if link.exists() || link.symlink_metadata().is_ok() {
            continue;
        }

        #[cfg(windows)]
        {
            // Directory junction via mklink /J — works without admin rights.
            let result = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&target)
                .output();
            match result {
                Ok(out) if out.status.success() => {}
                Ok(out) => failures.push(format!(
                    "{}: mklink exit {} ({})",
                    name.to_string_lossy(),
                    out.status.code().unwrap_or(-1),
                    String::from_utf8_lossy(&out.stderr).trim(),
                )),
                Err(e) => failures.push(format!("{}: {e}", name.to_string_lossy())),
            }
        }
        #[cfg(not(windows))]
        {
            if let Err(e) = std::os::unix::fs::symlink_dir(&target, &link) {
                failures.push(format!("{}: {e}", name.to_string_lossy()));
            }
        }
    }
    failures
}

/**
 * Ensure the skill aggregation root exists and links every `~/.agents/skills`
 * skill into it.
 *
 * The 技能管理 inventory reads a SINGLE root — `~/.dsh/skills` — which is the
 * real source of truth. Skills installed by DSH land there directly, while the
 * `~/.agents` skills (the Claude-Code agent root the user may also keep) are
 * aggregated in by linking each `~/.agents/skills/<name>` directory under
 * `~/.dsh/skills/<name>`. Linking (not copying) keeps one physical copy: edits
 * in either location are the same files.
 *
 * Windows uses directory junctions (`mklink /J`, no admin rights); POSIX uses
 * symlinks. A link whose target already exists is skipped; a name collision
 * (a real `~/.dsh/skills/<name>` that is not a link to the agent root) is left
 * alone so the user's own skill wins.
 *
 * The browser calls this lazily before the first `skillInventory/list` read.
 */
#[tauri::command]
pub fn skill_roots_ensure(state: State<'_, SharedState>) -> AppResult<()> {
    let s = state.read();
    let agents_home = s
        .dsh_home
        .parent()
        .map(|home| home.join(".agents"))
        .unwrap_or_else(|| PathBuf::from(".agents"));
    let failures = ensure_skill_roots(&s.dsh_home, &agents_home);
    if failures.is_empty() {
        Ok(())
    } else {
        Err(AppError::FsIo {
            message: format!("skill_roots_ensure: {}", failures.join("; ")),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;
    use std::fs;

    #[test]
    fn ensure_links_agent_skills_into_dsh_root() {
        let root = temp_dir().join(format!("dsh-skills-ensure-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dsh_home = root.join(".dsh");
        let agents_skills = root.join(".agents").join("skills");
        let skill_dir = agents_skills.join("one");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "---\nname: one\n---\n").unwrap();

        let failures = ensure_skill_roots(&dsh_home, &root.join(".agents"));
        assert!(failures.is_empty(), "failures: {failures:?}");
        assert!(dsh_home.join("skills").is_dir(), "~/.dsh/skills created");
        let link = dsh_home.join("skills").join("one");
        assert!(link.exists(), "~/.dsh/skills/one links the agent skill");
        assert!(link.join("SKILL.md").exists(), "linked skill readable");

        // Idempotent: a second run does not error or duplicate.
        let failures2 = ensure_skill_roots(&dsh_home, &root.join(".agents"));
        assert!(failures2.is_empty(), "second run clean: {failures2:?}");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_skips_when_agents_skills_absent() {
        let root = temp_dir().join(format!("dsh-skills-ensure-absent-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dsh_home = root.join(".dsh");
        // No ~/.agents at all — must be a clean no-op that still creates the root.
        let failures = ensure_skill_roots(&dsh_home, &root.join(".agents"));
        assert!(failures.is_empty());
        assert!(dsh_home.join("skills").is_dir());
        let _ = fs::remove_dir_all(&root);
    }
}