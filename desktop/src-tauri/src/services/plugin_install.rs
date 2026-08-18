use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum InstallSpec {
    Npm {
        name: String,
        version_req: Option<String>,
    },
    Git {
        url: String,
        branch: Option<String>,
    },
    Folder {
        path: String,
    },
}

pub fn parse_spec(spec: &str) -> AppResult<InstallSpec> {
    if let Some(rest) = spec.strip_prefix("npm:") {
        if rest.starts_with('@') {
            // Scoped package — no version pin possible in this form
            Ok(InstallSpec::Npm { name: rest.to_string(), version_req: None })
        } else if let Some(at_idx) = rest.rfind('@') {
            // Version-pinned unscoped package
            Ok(InstallSpec::Npm {
                name: rest[..at_idx].to_string(),
                version_req: Some(rest[at_idx+1..].to_string()),
            })
        } else {
            Ok(InstallSpec::Npm { name: rest.to_string(), version_req: None })
        }
    } else if spec.starts_with("git+") || spec.starts_with("github:") || spec.contains(".git") {
        Ok(InstallSpec::Git {
            url: spec.to_string(),
            branch: None,
        })
    } else if spec.starts_with("folder:") || spec.starts_with("/") || spec.contains(":\\") {
        let path = spec.strip_prefix("folder:").unwrap_or(spec).to_string();
        Ok(InstallSpec::Folder { path })
    } else {
        // Default: try as npm package
        Ok(InstallSpec::Npm {
            name: spec.to_string(),
            version_req: None,
        })
    }
}

#[derive(Deserialize)]
struct NpmMeta {
    #[serde(rename = "dist")]
    dist: NpmDist,
    version: String,
}

#[derive(Deserialize)]
struct NpmDist {
    tarball: String,
}

pub async fn npm_tarball_url(name: &str, http: &reqwest::Client) -> AppResult<String> {
    let url = format!("https://registry.npmjs.org/{name}/latest");
    let resp = http.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Network {
            message: format!("npm meta {name}: {}", resp.status()),
            status: Some(resp.status().as_u16()),
        });
    }
    let meta: NpmMeta = resp.json().await?;
    Ok(meta.dist.tarball)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_npm_with_at_scope() {
        let s = parse_spec("npm:@user/dsh-x").unwrap();
        match s {
            InstallSpec::Npm { name, .. } => assert_eq!(name, "@user/dsh-x"),
            _ => panic!("expected Npm"),
        }
    }

    #[test]
    fn parses_git() {
        let s = parse_spec("git+https://github.com/user/repo.git").unwrap();
        assert!(matches!(s, InstallSpec::Git { .. }));

        let s = parse_spec("github:user/repo").unwrap();
        assert!(matches!(s, InstallSpec::Git { .. }));
    }

    #[test]
    fn parses_folder() {
        let s = parse_spec("folder:/some/path").unwrap();
        assert!(matches!(s, InstallSpec::Folder { .. }));

        let s = parse_spec("/abs/path").unwrap();
        assert!(matches!(s, InstallSpec::Folder { .. }));
    }

    #[test]
    fn defaults_to_npm() {
        let s = parse_spec("plain-pkg-name").unwrap();
        assert!(matches!(s, InstallSpec::Npm { .. }));
    }

    #[test]
    fn parses_npm_with_version_req() {
        let s = parse_spec("npm:lodash@^4.0.0").unwrap();
        match s {
            InstallSpec::Npm { name, version_req } => {
                assert_eq!(name, "lodash");
                assert_eq!(version_req.as_deref(), Some("^4.0.0"));
            }
            _ => panic!("expected Npm"),
        }
    }

    #[test]
    fn parses_npm_scoped_without_version() {
        let s = parse_spec("npm:@scope/pkg").unwrap();
        match s {
            InstallSpec::Npm { name, version_req } => {
                assert_eq!(name, "@scope/pkg");
                assert_eq!(version_req, None);
            }
            _ => panic!("expected Npm"),
        }
    }
}
