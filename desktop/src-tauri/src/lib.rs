mod commands;
mod error;
mod services;
mod state;

use crate::commands::app::{app_config_dir, app_version, crash_log_path};
use crate::commands::credentials::{credentials_delete, credentials_get, credentials_set, dsh_read_credentials};
use crate::commands::deeplink::{deeplink_import, deeplink_parse};
use crate::commands::dialog::{dialog_message, dialog_open, dialog_save};
use crate::commands::fs::{cwd_resolve, fs_exists, fs_list, fs_read, fs_write};
use crate::commands::http::{http_request, http_set_proxy, proxy_test};
use crate::commands::inventory::inventory_set_enabled;
use crate::commands::plugin::{
    plugin_get_manifest, plugin_install, plugin_list, plugin_read_file, plugin_reload,
    plugin_uninstall,
};
use crate::commands::settings::{dsh_config_dir, settings_get, settings_update};
use crate::commands::shell::shell_spawn;
use crate::commands::workspaces::dsh_read_workspaces;
use crate::services::crash;
use crate::services::platform::Platform;
use crate::services::plugin_registry::PluginRegistry;
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
                PluginRegistry::new(&*conn).init_schema()?;
            }
            // Honor a persisted outbound proxy (the settings panel writes
            // `proxy.url`); fall back to a direct client when none is set.
            let persisted_proxy: Option<String> = SettingsStore::new(&*db.lock().expect("db mutex poisoned"))
                .get("proxy")
                .ok()
                .flatten()
                .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(String::from));
            let mut http_builder = reqwest::Client::builder()
                .user_agent(concat!("DeepSeek-Harness/", env!("CARGO_PKG_VERSION")));
            if let Some(proxy_url) = persisted_proxy.as_deref().filter(|u| !u.trim().is_empty()) {
                http_builder = http_builder.proxy(reqwest::Proxy::all(proxy_url)?);
            }
            let http = Arc::new(http_builder.build()?);
            let dsh_home = crate::services::dsh_settings::dsh_home_dir();
            std::fs::create_dir_all(&dsh_home)?;
            let state = AppState {
                config_dir,
                dsh_home,
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
        .invoke_handler(tauri::generate_handler![app_config_dir, app_version, crash_log_path, credentials_delete, credentials_get, credentials_set, dsh_read_credentials, cwd_resolve, deeplink_import, deeplink_parse, dialog_message, dialog_open, dialog_save, fs_exists, fs_list, fs_read, fs_write, http_request, http_set_proxy, proxy_test, inventory_set_enabled, plugin_get_manifest, plugin_install, plugin_list, plugin_read_file, plugin_reload, plugin_uninstall, settings_get, settings_update, dsh_config_dir, dsh_read_workspaces, shell_spawn])
        .run(tauri::generate_context!())
        .expect("error while running DSH desktop");
}
