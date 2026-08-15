mod commands;
mod config;
mod lifecycle;
mod menu;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&config::product_name());
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match lifecycle::spawn_sidecar(&handle).await {
                        Ok(sidecar) => {
                            let url = format!("http://127.0.0.1:{}", sidecar.port);
                            if let Some(window) = handle.get_webview_window("main") {
                                if let Ok(url) = tauri::Url::parse(&url) {
                                    let _ = window.navigate(url);
                                }
                            }
                            break;
                        }
                        Err(e) => {
                            eprintln!("sidecar failed: {e}");
                            if !show_spawn_error(&handle, &e) {
                                handle.exit(0);
                                break;
                            }
                        }
                    }
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

/// Show a blocking error dialog for a failed sidecar spawn, with Retry/Quit buttons.
///
/// Returns true when the user picks "Retry" (re-attempt the spawn) and false when
/// they pick "Quit". Uses the non-blocking `show` API (which dispatches to the main
/// thread internally) and blocks the caller on a channel until the user responds.
fn show_spawn_error(app: &tauri::AppHandle, err: &str) -> bool {
    let product_name = config::product_name();
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .message(format!("Failed to start the {product_name} backend:\n\n{err}"))
        .title(product_name)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Retry".into(),
            "Quit".into(),
        ))
        .show(move |retry| {
            let _ = tx.send(retry);
        });
    rx.recv().unwrap_or(false)
}
