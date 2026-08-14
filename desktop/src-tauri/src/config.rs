//! Client-id configuration for the desktop crate.
//!
//! The GitHub OAuth App client id is public (PKCE flow, no client secret), so it
//! can live in the repository. Replace the placeholder below with your OAuth App's
//! client id before building a release — see `desktop/README.md`.

pub const GITHUB_CLIENT_ID: &str = "REPLACE_WITH_YOUR_GITHUB_OAUTH_CLIENT_ID";
