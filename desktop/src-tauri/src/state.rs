use crate::commands::mcp_stdio::McpStdioChildMap;
use crate::services::platform;
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub config_dir: PathBuf,
    /** `~/.dsh` — the DSH CLI home the desktop must share settings with. */
    pub dsh_home: PathBuf,
    // rusqlite::Connection is !Sync, so we use Mutex (not RwLock as originally specced).
    // Acceptable for Phase 1's low-traffic SQLite; document the deviation.
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub http: Arc<reqwest::Client>,
    pub platform: platform::Platform,
    /** Live MCP stdio child processes keyed by connection id. */
    pub mcp_stdio: Arc<tokio::sync::Mutex<McpStdioChildMap>>,
    /** Monotonic connection-id source (ids are never reused, even after close). */
    pub mcp_conn_seq: Arc<AtomicU64>,
}

pub type SharedState = Arc<RwLock<AppState>>;
