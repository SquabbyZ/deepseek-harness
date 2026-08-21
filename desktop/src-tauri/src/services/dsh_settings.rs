//! DSH settings-backed store: reads/writes `~/.dsh/settings.yaml`, the same
//! file the real DSH CLI persists, so the desktop shares config with it.
//! The file is a nested YAML map keyed by settings namespace.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub struct DshSettingsFile {
    pub path: PathBuf,
}

impl DshSettingsFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// The whole settings document (namespace -> value), empty when absent.
    pub fn read_all(&self) -> Value {
        if !self.path.exists() {
            return json!({});
        }
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_yaml::from_str::<Value>(&text).ok())
            .unwrap_or_else(|| json!({}))
    }

    pub fn write_all(&self, value: &Value) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let yaml = serde_yaml::to_string(value).map_err(|e| format!("serialize: {e}"))?;
        std::fs::write(&self.path, yaml).map_err(|e| format!("write {}: {e}", self.path.display()))
    }

    /// One namespace's persisted value, or the default when unset.
    pub fn get_namespace(&self, ns: &str) -> Value {
        self.read_all().get(ns).cloned().unwrap_or_else(|| json!({}))
    }

    /// Set one namespace (deep-merged for object values) and persist.
    pub fn set_namespace(&self, ns: &str, value: &Value) -> Result<(), String> {
        let mut all = self.read_all();
        let merged = match (all.get(ns), value) {
            (Some(Value::Object(existing)), Value::Object(next)) => {
                let mut out = existing.clone();
                for (key, val) in next {
                    out.insert(key.clone(), val.clone());
                }
                Value::Object(out)
            }
            _ => value.clone(),
        };
        all.as_object_mut()
            .map(|map| map.insert(ns.to_string(), merged))
            .expect("read_all returns an object");
        self.write_all(&all)
    }
}

/// Resolve the DSH home (`~/.dsh`) from the user home directory.
pub fn dsh_home_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    home.join(".dsh")
}

/// Shorthand: the settings.yaml path under `~/.dsh`.
pub fn settings_file() -> DshSettingsFile {
    DshSettingsFile::new(dsh_home_dir().join("settings.yaml"))
}

/// True when `path` sits under the DSH home.
#[allow(dead_code)]
pub fn under_dsh_home(path: &Path) -> bool {
    path.starts_with(dsh_home_dir())
}
