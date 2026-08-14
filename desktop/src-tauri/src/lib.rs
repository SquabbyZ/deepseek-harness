mod commands;
mod lifecycle;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
