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

/// Allow a path when it lives under the Tauri app config dir, the DSH home
/// (`~/.dsh`), or the agent root (`~/.agents`). The skill inventory reads
/// `~/.dsh/skills`, which sits under `dsh_home`; that root aggregates the
/// agent skills as directory junctions whose canonical form resolves under
/// `~/.agents` — so reads through those junctions must also be allowed.
/// All roots are canonicalized before comparison so a symlinked path still
/// resolves within the allowlist.
pub fn is_allowed_roots(
    config_dir: &Path,
    dsh_home: &Path,
    agents_home: &Path,
    path: &Path,
) -> bool {
    let Ok(canonical) = path.canonicalize() else { return false };
    [config_dir, dsh_home, agents_home].iter().any(|root| {
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
        match p.canonicalize() {
            Ok(canonical) => {
                return [config_dir, dsh_home].iter().any(|root| {
                    root.canonicalize()
                        .map(|root_canonical| canonical.starts_with(root_canonical))
                        .unwrap_or(false)
                });
            }
            Err(_) => {
                // `canonicalize` failed on this component. If the component
                // itself exists as a symlink it must be a dangling link (its
                // target cannot be resolved): `fs::write`/`create_dir_all`
                // would follow it and create files at the target, which may
                // escape the roots. Reject rather than skip past it.
                if let Ok(meta) = std::fs::symlink_metadata(p) {
                    if meta.file_type().is_symlink() {
                        return false;
                    }
                }
            }
        }
        current = p.parent();
    }
    false
}

pub fn read(
    config_dir: &Path,
    dsh_home: &Path,
    agents_home: &Path,
    path: &Path,
) -> AppResult<Vec<u8>> {
    if !is_allowed_roots(config_dir, dsh_home, agents_home, path) {
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
        // NOTE: fs_write intentionally does NOT allow the agent root — creation
        // stays confined to config_dir + dsh_home; the agent root is read-only
        // via the aggregation junctions.
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

pub fn list(
    config_dir: &Path,
    dsh_home: &Path,
    agents_home: &Path,
    dir: &Path,
) -> AppResult<Vec<FsEntry>> {
    if !is_allowed_roots(config_dir, dsh_home, agents_home, dir) {
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
        // `entry.file_type()` follows symlinks/junctions on every platform
        // (Windows FILE_ATTRIBUTE_DIRECTORY for a directory reparse point),
        // whereas `entry.metadata().is_dir()` returns the link's own attributes
        // and reports is_dir=false for a directory junction. The latter broke
        // the skill inventory once we linked ~/.agents/skills/* into
        // ~/.dsh/skills as junctions.
        let file_type = entry.file_type().map_err(|e| AppError::FsIo {
            message: e.to_string(),
        })?;
        let size = entry
            .metadata()
            .map(|m| m.len())
            .map_err(|e| AppError::FsIo { message: e.to_string() })?;
        out.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: file_type.is_dir(),
            size,
        });
    }
    Ok(out)
}

pub fn exists(config_dir: &Path, dsh_home: &Path, agents_home: &Path, path: &Path) -> bool {
    is_allowed_roots(config_dir, dsh_home, agents_home, path) && path.exists()
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
    fn allowlist_accepts_dsh_home_and_agents_home_roots() {
        let config = temp_dir().join("dsh_test_config");
        let dsh_home = temp_dir().join("dsh_test_home");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&dsh_home).unwrap();
        let skills = dsh_home.join("skills");
        std::fs::create_dir_all(&skills).unwrap();
        let skill_file = skills.join("SKILL.md");
        std::fs::write(&skill_file, b"x").unwrap();
        // A path under dsh_home is allowed even when it lives outside config_dir.
        let agents = temp_dir().join("dsh_test_agents");
        std::fs::create_dir_all(&agents).unwrap();
        let agent_skill = agents.join("skills").join("one").join("SKILL.md");
        std::fs::create_dir_all(agent_skill.parent().unwrap()).unwrap();
        std::fs::write(&agent_skill, b"x").unwrap();
        assert!(is_allowed_roots(&config, &dsh_home, &agents, &skill_file));
        // The agent root (~/.agents) is also an allowed read root — aggregation
        // junctions canonicalize into it.
        assert!(is_allowed_roots(&config, &dsh_home, &agents, &agent_skill));
        // A sibling outside all three roots stays rejected.
        let outside = temp_dir().join("dsh_test_outside_dir");
        std::fs::create_dir_all(&outside).unwrap();
        assert!(!is_allowed_roots(&config, &dsh_home, &agents, &outside.join("x")));
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

    #[test]
    fn write_rejects_dangling_symlink_leaf() {
        let config = temp_dir().join("dsh_test_config");
        let dsh_home = temp_dir().join("dsh_test_home");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&dsh_home).unwrap();
        // The link points at a target that does not exist (dangling). Without
        // the guard below, `canonicalize` fails on the leaf, the walk passes on
        // the in-root parent, and `fs::write` creates the file at the symlink
        // target OUTSIDE the roots.
        let target = temp_dir().join("dsh_dangling_target");
        let _ = std::fs::remove_file(&target); // keep it dangling
        let link = dsh_home.join("SKILL.md");
        let _ = std::fs::remove_file(&link);

        #[cfg(unix)]
        let created = std::os::unix::fs::symlink(&target, &link).is_ok();
        #[cfg(windows)]
        let created = std::os::windows::fs::symlink_file(&target, &link).is_ok();

        if !created {
            // Creating a symlink needs Developer Mode / elevation on Windows;
            // when the OS refuses there is nothing to exercise here.
            return;
        }

        assert!(
            !is_creatable_allowed(&config, &dsh_home, &link),
            "a dangling symlink leaf must not be creatable-through"
        );
        assert!(write(&config, &dsh_home, &link, b"x").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn write_rejects_dangling_junction_leaf() {
        // Directory junctions (`mklink /J`) need no admin rights, so they let
        // the dangling-symlink guard be exercised on Windows even when creating
        // a real file symlink would require Developer Mode / elevation.
        let config = temp_dir().join("dsh_test_config");
        let dsh_home = temp_dir().join("dsh_test_home");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&dsh_home).unwrap();
        let target = temp_dir().join("dsh_junction_target_dir");
        std::fs::create_dir_all(&target).unwrap();
        let link = dsh_home.join("escape");
        let _ = std::fs::remove_dir_all(&link);

        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .status();
        if !status.map(|s| s.success()).unwrap_or(false) {
            return; // junction creation refused — nothing to exercise
        }
        // Break the target so the junction is dangling.
        std::fs::remove_dir_all(&target).unwrap();

        assert!(
            !is_creatable_allowed(&config, &dsh_home, &link),
            "a dangling junction leaf must not be creatable-through"
        );
        assert!(write(&config, &dsh_home, &link, b"x").is_err());
    }
}