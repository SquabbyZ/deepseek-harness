use std::path::PathBuf;

pub fn crash_log_path(config_dir: &PathBuf) -> PathBuf {
    config_dir.join("crash.log")
}

pub fn init_panic_hook(config_dir: &PathBuf) {
    let path = crash_log_path(config_dir);
    std::panic::set_hook(Box::new(move |info| {
        let line = format!(
            "{:?}\n",
            serde_json::json!({
                "ts": chrono_now(),
                "panic": info.to_string(),
            })
        );
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
    }));
}

fn chrono_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}