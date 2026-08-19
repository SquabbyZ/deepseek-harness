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

pub fn read(config_dir: &Path, path: &Path) -> AppResult<Vec<u8>> {
    if !is_allowed(config_dir, path) {
        return Err(AppError::FsPermissionDenied {
            path: path.to_string_lossy().into_owned(),
        });
    }
    std::fs::read(path).map_err(|e| AppError::FsIo {
        message: e.to_string(),
    })
}

pub fn write(config_dir: &Path, path: &Path, content: &[u8]) -> AppResult<()> {
    if !is_allowed(config_dir, path) {
        return Err(AppError::FsPermissionDenied {
            path: path.to_string_lossy().into_owned(),
        });
    }
    std::fs::write(path, content).map_err(|e| AppError::FsIo {
        message: e.to_string(),
    })
}

pub fn list(config_dir: &Path, dir: &Path) -> AppResult<Vec<FsEntry>> {
    if !is_allowed(config_dir, dir) {
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

pub fn exists(config_dir: &Path, path: &Path) -> bool {
    is_allowed(config_dir, path) && path.exists()
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
}