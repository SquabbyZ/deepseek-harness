#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    load_env();
    dsh_desktop_lib::run()
}

/// Load `DSH_GITHUB_CLIENT_ID` from a `.env` in the current directory or any
/// ancestor, so a repo-root `.env` is picked up even though `tauri dev` runs
/// from `desktop/src-tauri`.
fn load_env() {
    let mut dir = std::env::current_dir().ok();
    for _ in 0..5 {
        if let Some(current) = dir.as_ref() {
            let _ = dotenvy::from_path(current.join(".env"));
        }
        dir = dir.and_then(|d| d.parent().map(|p| p.to_path_buf()));
    }
}
