mod error;
mod services;
mod state;

use std::sync::Arc;
use parking_lot::RwLock;
use tauri::Manager;
use crate::services::platform::Platform;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("config_dir: {e}"))?;
            std::fs::create_dir_all(&config_dir)?;
            let db_path = config_dir.join("config.sqlite");
            let db = Arc::new(std::sync::Mutex::new(rusqlite::Connection::open(&db_path)?));
            let http = Arc::new(
                reqwest::Client::builder()
                    .user_agent(concat!(
                        "DeepSeek-Harness/",
                        env!("CARGO_PKG_VERSION")
                    ))
                    .build()?,
            );
            let state = AppState {
                config_dir,
                db,
                http,
                platform: Platform::current(),
            };
            app.manage(Arc::new(RwLock::new(state)));

            // Show window on first paint
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running DSH desktop");
}