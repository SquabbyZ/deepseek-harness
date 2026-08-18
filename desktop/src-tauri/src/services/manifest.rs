use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub name: String,
    pub version: String,
    pub kind: String, // plugin | skill | mcp | agent
    #[serde(default)]
    pub platforms: HashMap<String, String>,
    #[serde(default = "default_host")]
    pub host: String, // browser | node
    pub permissions: Vec<String>,
    pub entry: String,
    #[serde(default)]
    pub client: Option<String>,
}

fn default_host() -> String {
    "browser".to_string()
}

pub fn parse(manifest_json: &str) -> AppResult<Manifest> {
    let m: Manifest = serde_json::from_str(manifest_json).map_err(|e| AppError::InvalidManifest {
        field: "root".into(),
        hint: e.to_string(),
    })?;
    if m.kind != "plugin" && m.kind != "skill" && m.kind != "mcp" && m.kind != "agent" {
        return Err(AppError::InvalidManifest {
            field: "kind".into(),
            hint: format!("must be plugin/skill/mcp/agent, got {}", m.kind),
        });
    }
    if m.host != "browser" && m.host != "node" {
        return Err(AppError::InvalidManifest {
            field: "host".into(),
            hint: format!("must be browser/node, got {}", m.host),
        });
    }
    if m.permissions.is_empty() {
        return Err(AppError::InvalidManifest {
            field: "permissions".into(),
            hint: "must declare at least one permission".into(),
        });
    }
    Ok(m)
}

const NODE_BUILTINS: &[&str] = &[
    "fs",
    "path",
    "os",
    "child_process",
    "crypto",
    "buffer",
    "stream",
    "events",
    "url",
    "http",
    "https",
    "net",
    "tls",
    "zlib",
    "util",
    "querystring",
    "readline",
    "vm",
    "worker_threads",
    "cluster",
    "dgram",
    "dns",
];

pub async fn verify_browser_safe(plugin_dir: &Path) -> AppResult<()> {
    let entry_path = plugin_dir.join("dist/plugin.js");
    if !entry_path.exists() {
        return Err(AppError::PluginNotBrowserSafe {
            issue: "missing dist/plugin.js".into(),
            file: entry_path.to_string_lossy().into_owned(),
        });
    }
    let content = std::fs::read_to_string(&entry_path).map_err(|e| AppError::FsIo {
        message: e.to_string(),
    })?;

    // 1. AST check via esbuild subprocess (sandboxed)
    use crate::services::platform::npx_executable_name;
    let output = tokio::process::Command::new(npx_executable_name())
        .arg("--no-install")
        .arg("esbuild")
        .arg("--bundle=false")
        .arg("--metafile")
        .arg("--platform=browser")
        .arg("--format=esm")
        .arg(&entry_path)
        .output()
        .await
        .map_err(|e| AppError::PluginNotBrowserSafe {
            issue: format!("esbuild spawn: {e}"),
            file: entry_path.to_string_lossy().into_owned(),
        })?;

    if !output.status.success() {
        return Err(AppError::PluginNotBrowserSafe {
            issue: format!("esbuild failed: {}", String::from_utf8_lossy(&output.stderr)),
            file: entry_path.to_string_lossy().into_owned(),
        });
    }

    // 2. String-level check: no `require('fs')` etc.
    for builtin in NODE_BUILTINS {
        let pattern = format!("require(\"{builtin}\")");
        if content.contains(&pattern) {
            return Err(AppError::PluginNotBrowserSafe {
                issue: format!("uses Node builtin {builtin}"),
                file: entry_path.to_string_lossy().into_owned(),
            });
        }
        let pattern2 = format!("require('{builtin}')");
        if content.contains(&pattern2) {
            return Err(AppError::PluginNotBrowserSafe {
                issue: format!("uses Node builtin {builtin}"),
                file: entry_path.to_string_lossy().into_owned(),
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_manifest() {
        let m = parse(
            r#"{"name":"x","version":"0.1.0","kind":"plugin","permissions":["fs.read"],"entry":"dist/x.js"}"#,
        )
        .unwrap();
        assert_eq!(m.host, "browser");
        assert_eq!(m.permissions.len(), 1);
    }

    #[test]
    fn rejects_bad_kind() {
        let r = parse(
            r#"{"name":"x","version":"0.1.0","kind":"banana","permissions":["fs.read"],"entry":"x.js"}"#,
        );
        assert!(r.is_err());
    }

    #[test]
    fn rejects_empty_permissions() {
        let r = parse(
            r#"{"name":"x","version":"0.1.0","kind":"plugin","permissions":[],"entry":"x.js"}"#,
        );
        assert!(r.is_err());
    }

    #[test]
    fn rejects_invalid_json() {
        let r = parse(r#"{not valid json"#);
        assert!(r.is_err());
    }

    #[test]
    fn parses_with_host_node() {
        let m = parse(
            r#"{"name":"x","version":"0.1.0","kind":"agent","host":"node","permissions":["fs.read"],"entry":"dist/x.js"}"#,
        )
        .unwrap();
        assert_eq!(m.host, "node");
    }

    #[test]
    fn rejects_bad_host() {
        let r = parse(
            r#"{"name":"x","version":"0.1.0","kind":"plugin","host":"electron","permissions":["fs.read"],"entry":"x.js"}"#,
        );
        assert!(r.is_err());
    }

    #[test]
    fn accepts_all_kinds() {
        for kind in ["plugin", "skill", "mcp", "agent"] {
            let json = format!(
                r#"{{"name":"x","version":"0.1.0","kind":"{kind}","permissions":["fs.read"],"entry":"x.js"}}"#
            );
            assert!(parse(&json).is_ok(), "kind {kind} should be accepted");
        }
    }
}
