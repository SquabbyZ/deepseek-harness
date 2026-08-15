//! Client-id configuration for the desktop crate.
//!
//! The GitHub OAuth App client id is public (PKCE flow, no client secret). It is
//! injected via the `DSH_GITHUB_CLIENT_ID` environment variable, which a `.env`
//! file at the repository root can populate — see `desktop/README.md`. Left
//! unset, the sidecar reports "client id not configured" on login instead of
//! failing with an opaque GitHub error.

/// The GitHub OAuth App client id, read from the `DSH_GITHUB_CLIENT_ID` env var.
pub fn github_client_id() -> String {
    std::env::var("DSH_GITHUB_CLIENT_ID").unwrap_or_default()
}
