//! Client-id configuration for the desktop crate.
//!
//! The GitHub OAuth App client id is public (PKCE flow, no client secret). It is
//! injected via the `DSH_GITHUB_CLIENT_ID` environment variable, which a `.env`
//! file at the repository root can populate — see `desktop/README.md`. Left
//! unset, the sidecar reports "client id not configured" on login instead of
//! failing with an opaque GitHub error.

/// The GitHub OAuth App client id, read from the `GITHUB_OAUTH_CLIENT_ID` env
/// var. It is deliberately NOT `DSH_`-prefixed: the dsh launcher forbids `DSH_*`
/// (and other bootstrap prefixes) in `.env` files. The desktop shell maps this
/// value onto `DSH_GITHUB_CLIENT_ID` for the sidecar process.
pub fn github_client_id() -> String {
    std::env::var("GITHUB_OAUTH_CLIENT_ID").unwrap_or_default()
}

/// The GitHub OAuth App client secret, read from `GITHUB_OAUTH_CLIENT_SECRET`.
/// Empty when the app uses PKCE (no secret). Mapped onto `DSH_GITHUB_CLIENT_SECRET`
/// for the sidecar process.
pub fn github_client_secret() -> String {
    std::env::var("GITHUB_OAUTH_CLIENT_SECRET").unwrap_or_default()
}

/// The product (brand) name shown in the window title, the spawn-error dialog,
/// and the Web sidebar wordmark. Read from the `PRODUCT_NAME` env var — like the
/// GitHub pair it is deliberately NOT `DSH_`-prefixed, because the dsh launcher
/// forbids `DSH_*` in `.env` files. The desktop shell maps this value onto
/// `DSH_PRODUCT_NAME` for the sidecar process, which exposes it to the Web
/// surface. Unset (or empty) falls back to the shipped brand.
pub fn product_name() -> String {
    std::env::var("PRODUCT_NAME")
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "DeepSeek Harness".to_owned())
}

/// The OS home directory (Windows `%USERPROFILE%`, Unix `$HOME`).
pub fn home_dir() -> Option<std::path::PathBuf> {
    if cfg!(windows) {
        std::env::var("USERPROFILE").ok().map(std::path::PathBuf::from)
    } else {
        std::env::var("HOME").ok().map(std::path::PathBuf::from)
    }
}

/// The harness home directory: `$DSH_HOME` when set, otherwise `<os home>/.dsh`.
fn harness_home() -> Option<std::path::PathBuf> {
    std::env::var("DSH_HOME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| home_dir().map(|h| h.join(".dsh")))
}

/// The durable theme preference (`light` / `dark` / `system`) persisted by the
/// Appearance row in the Host user-settings document (`settings.yaml` under the
/// harness home). Read ahead of the Web shell so the frontend placeholder can
/// match the chosen theme before the sidecar injects the same value into the
/// real shell. Absent / unparsable falls back to `system`.
pub fn theme_preference() -> String {
    let Some(home) = harness_home() else { return "system".to_owned() };
    let path = home.join("settings.yaml");
    let Ok(text) = std::fs::read_to_string(path) else { return "system".to_owned() };

    // Lightweight YAML scan for the `ui-theme` namespace's `preference` leaf.
    // The document is a flat map of namespace sections; `ui-theme:` is a
    // top-level key and `preference:` a value indented beneath it. Stop at the
    // next top-level key (non-indented, non-comment, non-empty).
    let mut in_theme = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "ui-theme:" {
            in_theme = true;
            continue;
        }
        if in_theme {
            let indented = line.starts_with(' ') || line.starts_with('\t');
            if !indented && !trimmed.is_empty() && !trimmed.starts_with('#') {
                break;
            }
            if let Some(value) = trimmed.strip_prefix("preference:") {
                let value = value.trim().trim_matches(['"', '\'']).trim();
                return match value {
                    "light" | "dark" | "system" => value.to_owned(),
                    _ => "system".to_owned(),
                };
            }
        }
    }
    "system".to_owned()
}
