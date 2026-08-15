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
