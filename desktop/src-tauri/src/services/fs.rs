use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

pub fn is_allowed(config_dir: &Path, path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else { return false };
    let Ok(config_canonical) = config_dir.canonicalize() else { return false };
    canonical.starts_with(config_canonical)
}

/// Allow a path when it lives under EITHER the Tauri app config dir OR the DSH
/// home (`~/.dsh`). The skill inventory reads `~/.dsh/skills`, which sits under
/// `dsh_home` — a sibling of the app config dir — so the single-root check alone
/// would reject it. Both roots are canonicalized before comparison so a
/// symlinked path still resolves within the allowlist.
pub fn is_allowed_roots(config_dir: &Path, dsh_home: &Path, path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else { return false };
    [config_dir, dsh_home].iter().any(|root| {
        root.canonicalize()
            .map(|root_canonical| canonical.starts_with(root_canonical))
            .unwrap_or(false)
    })
}

/// Allow CREATING a path that may not exist yet: canonicalize the deepest
/// existing ancestor and check it against the allowlist. This is what lets
/// `fs_write` install a fresh `~/.dsh/skills/{name}` (neither the dir nor the
/// file exists yet, so `is_allowed_roots` alone would reject it) without
/// widening the allowlist to the whole disk — you can still only create things
/// UNDER one of the allowed roots.
fn is_creatable_allowed(config_dir: &Path, dsh_home: &Path, path: &Path) -> bool {
    let mut current = Some(path);
    while let Some(p) = current {
        if let Ok(canonical) = p.canonicalize() {
            return [config_dir, dsh_home].iter().any(|root| {
                root.canonicalize()
                    .map(|root_canonical| canonical.starts_with(root_canonical))
                    .unwrap_or(false)
            });
        }
        current = p.parent();
    }
    false
}

pub fn read(config_dir: &Path, dsh_home: &Path, path: &Path) -> AppResult<Vec<u8>> {
    if !is_allowed_roots(config_dir, dsh_home, path) {
        return Err(AppError::FsPermissionDenied {
            path: path.to_string_lossy().into_owned(),
        });
    }
    std::fs::read(path).map_err(|e| AppError::FsIo {
        message: e.to_string(),
    })
}

pub fn write(config_dir: &Path, dsh_home: &Path, path: &Path, content: &[u8]) -> AppResult<()> {
    if !is_creatable_allowed(config_dir, dsh_home, path) {
        return Err(AppError::FsPermissionDenied {
            path: path.to_string_lossy().into_owned(),
        });
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::FsIo {
                message: format!("create_dir_all {}: {e}", parent.display()),
            })?;
        }
    }
    std::fs::write(path, content).map_err(|e| AppError::FsIo {
        message: e.to_string(),
    })
}

pub fn list(config_dir: &Path, dsh_home: &Path, dir: &Path) -> AppResult<Vec<FsEntry>> {
    if !is_allowed_roots(config_dir, dsh_home, dir) {
        return Err(AppError::FsPermissionDenied {
            path: dir.to_string_lossy().into_owned(),
        });
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| AppError::FsIo {
        message: e.to_string(),
    })? {
        let entry = entry.map_err(|e| AppError::FsIo {
            message: e.to_string(),
        })?;
        let metadata = entry.metadata().map_err(|e| AppError::FsIo {
            message: e.to_string(),
        })?;
        out.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    Ok(out)
}

pub fn exists(config_dir: &Path, dsh_home: &Path, path: &Path) -> bool {
    is_allowed_roots(config_dir, dsh_home, path) && path.exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn allowlist_rejects_outside_config() {
        let config = temp_dir().join("dsh_test_config");
        std::fs::create_dir_all(&config).unwrap();
        let subfile = config.join("subfile");
        std::fs::write(&subfile, b"x").unwrap();
        let outside = std::env::temp_dir().join("dsh_test_outside");
        assert!(!is_allowed(&config, &outside));
        assert!(is_allowed(&config, &subfile));
    }

    #[test]
    fn allowlist_accepts_dsh_home_root() {
        let config = temp_dir().join("dsh_test_config");
        let dsh_home = temp_dir().join("dsh_test_home");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&dsh_home).unwrap();
        let skills = dsh_home.join("skills");
        std::fs::create_dir_all(&skills).unwrap();
        let skill_file = skills.join("SKILL.md");
        std::fs::write(&skill_file, b"x").unwrap();
        // A path under dsh_home is allowed even when it lives outside config_dir.
        assert!(is_allowed_roots(&config, &dsh_home, &skill_file));
        // A sibling of dsh_home (~/.agents/skills) stays outside both roots.
        let agents = temp_dir().join("dsh_test_agents");
        std::fs::create_dir_all(&agents).unwrap();
        assert!(!is_allowed_roots(&config, &dsh_home, &agents));
    }

    #[test]
    fn write_creates_fresh_paths_under_an_allowed_root() {
        let config = temp_dir().join("dsh_test_config");
        let dsh_home = temp_dir().join("dsh_test_home");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&dsh_home).unwrap();
        // Neither the skill dir nor its SKILL.md exists yet — but because the
        // deepest existing ancestor (dsh_home) is allowed, creation is legal and
        // write() materializes the intermediate directories.
        let dest = dsh_home.join("skills").join("shellcheck").join("SKILL.md");
        assert!(is_creatable_allowed(&config, &dsh_home, &dest));
        write(&config, &dsh_home, &dest, b"---\nname: shellcheck\n---").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"---\nname: shellcheck\n---");
    }

    #[test]
    fn write_rejects_creation_outside_an_allowed_root() {
        let config = temp_dir().join("dsh_test_config");
        let dsh_home = temp_dir().join("dsh_test_home");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&dsh_home).unwrap();
        let outside = temp_dir().join("dsh_outside_new").join("SKILL.md");
        assert!(!is_creatable_allowed(&config, &dsh_home, &outside));
        assert!(write(&config, &dsh_home, &outside, b"x").is_err());
    }
}