mod commands;
mod error;
mod services;
mod state;

use crate::commands::app::{app_version, crash_log_path};
use crate::commands::credentials::{credentials_delete, credentials_get, credentials_set};
use crate::commands::deeplink::{deeplink_import, deeplink_parse};
use crate::commands::dialog::{dialog_message, dialog_open, dialog_save};
use crate::commands::fs::{fs_exists, fs_list, fs_read, fs_write};
use crate::commands::http::http_request;
use crate::commands::plugin::{plugin_get_manifest, plugin_list, plugin_read_file};
use crate::commands::settings::{settings_get, settings_update};
use crate::commands::shell::shell_spawn;
use crate::services::crash;
use crate::services::platform::Platform;
use crate::services::settings::SettingsStore;
use crate::state::AppState;
use parking_lot::RwLock;
use std::sync::Arc;
use tauri::Manager;

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
            crash::init_panic_hook(&config_dir);
            let db_path = config_dir.join("config.sqlite");
            let db = Arc::new(std::sync::Mutex::new(rusqlite::Connection::open(&db_path)?));
            {
                let conn = db.lock().expect("db mutex poisoned");
                SettingsStore::new(&*conn).init_schema()?;
            }
            let http = Arc::new(
                reqwest::Client::builder()
                    .user_agent(concat!("DeepSeek-Harness/", env!("CARGO_PKG_VERSION")))
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
        .invoke_handler(tauri::generate_handler![app_version, crash_log_path, credentials_delete, credentials_get, credentials_set, deeplink_import, deeplink_parse, dialog_message, dialog_open, dialog_save, fs_exists, fs_list, fs_read, fs_write, http_request, plugin_get_manifest, plugin_list, plugin_read_file, settings_get, settings_update, shell_spawn])
        .run(tauri::generate_context!())
        .expect("error while running DSH desktop");
}
