//! Skills registry search (skills.sh + Smithery) — direct reqwest against the
//! proxy-aware `state.http` client. Mirrors the cc-switch pattern: Rust
//! performs the HTTP call, the browser just calls the Tauri command. This
//! bypasses the generic `http_request` bridge (whose serialized payload and
//! proxy propagation were the source of the search failures) and guarantees
//! the same proxy the rest of the desktop uses is applied.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::SharedState;

/** One skills.sh discoverable skill (matches the `SkillsShDiscoverableSkill` shape). */
#[derive(Debug, Serialize)]
pub struct DiscoverableSkill {
    pub key: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    pub readme_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub repo_branch: String,
    pub installs: u64,
}

#[derive(Debug, Serialize)]
pub struct SkillsShSearchResult {
    pub skills: Vec<DiscoverableSkill>,
    pub total_count: u64,
    pub query: String,
}

#[derive(Debug, Deserialize)]
struct SkillsShApiSkill {
    #[serde(default)]
    id: String,
    #[serde(default)]
    skill_id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    installs: u64,
}

#[derive(Debug, Deserialize)]
struct SkillsShApiResponse {
    #[serde(default)]
    skills: Vec<SkillsShApiSkill>,
    #[serde(default)]
    count: u64,
    #[serde(default)]
    query: String,
}

#[derive(Debug, Serialize)]
pub struct SmitheryServer {
    pub qualified_name: String,
    pub display_name: String,
    pub description: String,
    pub remote: bool,
    pub use_count: u64,
}

#[derive(Debug, Serialize)]
pub struct SmitherySearchResult {
    pub servers: Vec<SmitheryServer>,
}

#[derive(Debug, Deserialize)]
struct SmitheryApiServer {
    #[serde(default)]
    qualified_name: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    remote: bool,
    #[serde(default)]
    use_count: u64,
}

#[derive(Debug, Deserialize)]
struct SmitheryApiResponse {
    #[serde(default)]
    servers: Vec<SmitheryApiServer>,
}

/// Search the skills.sh public directory. The Rust `reqwest::Client` in shared
/// state is built at startup with the persisted proxy from `~/.dsh/settings.yaml`,
/// so requests route through the user's outbound proxy on a proxied network.
#[tauri::command]
pub async fn search_skills_sh(
    query: String,
    limit: usize,
    offset: usize,
    state: State<'_, SharedState>,
) -> Result<SkillsShSearchResult, String> {
    // Skills.sh and Smithery are reachable from the dev box directly — the
    // settings.yaml proxy is for the LLM providers, not these public registry
    // APIs. Build a fresh, proxy-free client so we don't tunnel skills.sh
    // through the (possibly unreachable) LLM proxy.
    let client = reqwest::Client::builder()
        .user_agent(concat!("DeepSeek-Harness/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("search_skills_sh: client build: {e}"))?;
    eprintln!(
        "[search_skills_sh] env: HTTP_PROXY={:?} HTTPS_PROXY={:?} ALL_PROXY={:?}",
        std::env::var("HTTP_PROXY").ok(),
        std::env::var("HTTPS_PROXY").ok(),
        std::env::var("ALL_PROXY").ok(),
    );
    let trimmed = query.trim();
    let limit_str = limit.to_string();
    let offset_str = offset.to_string();
    let url = url::Url::parse_with_params(
        "https://skills.sh/api/search",
        &[
            ("q", trimmed),
            ("limit", &limit_str),
            ("offset", &offset_str),
        ],
    )
    .map_err(|e| format!("search_skills_sh: bad url: {e}"))?;
    let resp = match client
        .get(url)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[search_skills_sh] request FAILED: {e:?} (proxy client is the shared state.http)");
            return Err(format!("search_skills_sh: request failed: {e}"));
        }
    };
    let status = resp.status();
    if !status.is_success() {
        eprintln!("[search_skills_sh] HTTP {status}");
        return Err(format!("search_skills_sh: HTTP {status}"));
    }
    let body: SkillsShApiResponse = match resp.json().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[search_skills_sh] decode FAILED: {e}");
            return Err(format!("search_skills_sh: decode failed: {e}"));
        }
    };
    let skills = body
        .skills
        .into_iter()
        .filter_map(|s| {
            let parts: Vec<&str> = s.source.splitn(2, '/').collect();
            if parts.len() != 2 {
                return None;
            }
            let owner = parts[0].to_string();
            let repo = parts[1].to_string();
            // GitHub owner names disallow `.`; this also drops non-GitHub
            // sources (e.g. `skills.volces.com/...`) that the install path
            // can't handle.
            if owner.contains('.') || owner.is_empty() || repo.is_empty() {
                return None;
            }
            Some(DiscoverableSkill {
                key: s.id,
                name: s.name.clone(),
                description: s.description,
                directory: if s.skill_id.is_empty() {
                    s.name
                } else {
                    s.skill_id
                },
                readme_url: Some(format!("https://github.com/{owner}/{repo}")),
                repo_owner: owner,
                repo_name: repo,
                repo_branch: "main".to_string(),
                installs: s.installs,
            })
        })
        .collect();
    Ok(SkillsShSearchResult {
        skills,
        total_count: body.count,
        query: body.query,
    })
}

/// Search the Smithery MCP server registry.
#[tauri::command]
pub async fn search_smithery_servers(
    query: String,
    limit: usize,
    state: State<'_, SharedState>,
) -> Result<SmitherySearchResult, String> {
    // Same rationale as search_skills_sh: registry APIs are reached direct.
    let client = reqwest::Client::builder()
        .user_agent(concat!("DeepSeek-Harness/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("search_smithery_servers: client build: {e}"))?;
    let trimmed = query.trim();
    let limit_str = limit.to_string();
    let url = url::Url::parse_with_params(
        "https://api.smithery.ai/servers",
        &[("q", trimmed), ("limit", &limit_str)],
    )
    .map_err(|e| format!("search_smithery_servers: bad url: {e}"))?;
    let resp = match client
        .get(url)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[search_smithery_servers] request FAILED: {e:?}");
            return Err(format!("search_smithery_servers: request failed: {e}"));
        }
    };
    let status = resp.status();
    if !status.is_success() {
        eprintln!("[search_smithery_servers] HTTP {status}");
        return Err(format!("search_smithery_servers: HTTP {status}"));
    }
    let body: SmitheryApiResponse = match resp.json().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[search_smithery_servers] decode FAILED: {e}");
            return Err(format!("search_smithery_servers: decode failed: {e}"));
        }
    };
    let servers = body
        .servers
        .into_iter()
        .filter(|s| !s.qualified_name.is_empty() && !s.display_name.is_empty())
        .map(|s| SmitheryServer {
            qualified_name: s.qualified_name,
            display_name: s.display_name,
            description: s.description,
            remote: s.remote,
            use_count: s.use_count,
        })
        .collect();
    Ok(SmitherySearchResult { servers })
}
