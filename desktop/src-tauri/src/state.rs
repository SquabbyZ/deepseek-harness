use crate::services::platform;
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub config_dir: PathBuf,
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub http: Arc<reqwest::Client>,
    pub platform: platform::Platform,
}

pub type SharedState = Arc<RwLock<AppState>>;
