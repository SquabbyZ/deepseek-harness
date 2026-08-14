mod commands;
mod lifecycle;
mod menu;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            menu::setup_tray(&app.handle())?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match lifecycle::spawn_sidecar(&handle).await {
                    Ok(sidecar) => {
                        let url = format!("http://127.0.0.1:{}", sidecar.port);
                        if let Some(window) = handle.get_webview_window("main") {
                            if let Ok(url) = tauri::Url::parse(&url) {
                                let _ = window.navigate(url);
                            }
                        }
                    }
                    Err(e) => eprintln!("sidecar failed: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::pick_directory])
        .build(tauri::generate_context!())
        .expect("error while building dsh-desktop")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<lifecycle::SidecarState>() {
                    if let Ok(mut child) = state.0.lock() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
