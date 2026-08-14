//! Client-id configuration for the desktop crate.
//!
//! The GitHub OAuth App client id is public (PKCE flow, no client secret), so it
//! can live in the repository. Set it to your OAuth App's client id before
//! building a release — see `desktop/README.md`. Left empty, the sidecar reports
//! "client id not configured" on login instead of failing with an opaque GitHub
//! error.

pub const GITHUB_CLIENT_ID: &str = "";
