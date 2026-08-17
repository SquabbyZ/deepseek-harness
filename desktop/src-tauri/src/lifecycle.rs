//! Sidecar lifecycle: port selection, spawn, health polling, graceful shutdown.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

pub const DEFAULT_PORT: u16 = 3080;
pub const MAX_PORT_PROBES: u16 = 32;

/// Lowest free port at or after `start`, skipping `taken`.
///
/// For each candidate, ports listed in `taken` are skipped and the OS is probed by
/// binding a loopback [`TcpListener`]: a successful bind means the port is free, so
/// the listener is dropped and the port returned. Probes at most
/// [`MAX_PORT_PROBES`] candidates; falls back to `start` if none are free.
pub fn pick_port_after(start: u16, taken: &HashSet<u16>) -> u16 {
    let mut port = start;
    for _ in 0..MAX_PORT_PROBES {
        if !taken.contains(&port) && TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
        port = port.wrapping_add(1);
    }
    start
}

/// Tauri's `resource_dir()` returns verbatim `\\?\`-prefixed paths on Windows,
/// which Node's `realpathSync` cannot resolve (`EISDIR: lstat 'C:'`). Strip the
/// prefix so the sidecar sees a normal `C:\...` path.
fn normalize_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy().into_owned();
    let stripped = raw
        .strip_prefix("\\\\?\\")
        .or_else(|| raw.strip_prefix("\\??\\"))
        .unwrap_or(raw.as_str());
    PathBuf::from(stripped)
}

/// A running sidecar plus the loopback port it serves.
pub struct SidecarHandle {
    pub port: u16,
    /// Retained for later supervision/restart (Task 9); not read yet.
    #[allow(dead_code)]
    pub child: Arc<Mutex<Child>>,
}

/// Managed state holding the sidecar child, so shutdown can kill it.
pub struct SidecarState(pub Arc<Mutex<Child>>);

/// Spawn the bundled `dsh` sidecar and wait until it answers on loopback.
///
/// The sidecar is portable Node (SEA was ruled infeasible): the runtime is bundled
/// as a resource directory `resources/dsh-runtime/` (Task 10), holding `node(.exe)`
/// and `dsh/lib/bin.js` + node_modules. We spawn `node <entry> web --port <port>`.
pub async fn spawn_sidecar(app: &AppHandle) -> Result<SidecarHandle, String> {
    let port = pick_port_after(DEFAULT_PORT, &HashSet::new());

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let runtime = resource_dir.join("dsh-runtime");
    let node = normalize_path(&runtime.join(if cfg!(windows) { "node.exe" } else { "node" }));
    let entry = normalize_path(&runtime.join("dsh").join("lib").join("bin.js"));

    let mut command = StdCommand::new(&node);
    command
        .arg(&entry)
        .arg("web")
        .arg("--port")
        .arg(port.to_string())
        .env("DSH_GITHUB_CLIENT_ID", crate::config::github_client_id())
        .env("DSH_GITHUB_CLIENT_SECRET", crate::config::github_client_secret())
        .env("DSH_PRODUCT_NAME", crate::config::product_name())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Windows: `node.exe` is a console-subsystem process, so spawning it from a
    // GUI app (no console) makes Windows allocate a fresh, empty console window
    // ("Windows PowerShell" under Windows Terminal). CREATE_NO_WINDOW keeps the
    // sidecar headless — its stdout/stderr are piped above and forwarded, so
    // there is nothing for the console to show anyway.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    // Root the agent's working directory at the user's home, not the install
    // directory. The sidecar otherwise inherits the shortcut's working dir
    // (`C:\Program Files\DeepSeek Harness` on Windows), which is read-only and
    // far from the user's files — the agent's shell/tool execution would start
    // there and "cannot reach the host environment". Home is the sane default;
    // the operator narrows it via the directory picker after launch.
    if let Some(home) = crate::config::home_dir() {
        command.current_dir(&home);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;

    // Forward sidecar stdout/stderr into the "dsh-log" event.
    if let Some(stdout) = child.stdout.take() {
        forward_pipe(stdout, app.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        forward_pipe(stderr, app.clone());
    }

    // Wrap the child and register it in state BEFORE the health check so no
    // failure path can leave it orphaned: shutdown can always reach it via
    // `SidecarState`, and we kill it explicitly if `wait_healthy` fails.
    let child = Arc::new(Mutex::new(child));
    app.manage(SidecarState(child.clone()));

    // Wait for the loopback port to come up (bounded retry).
    if let Err(e) = wait_healthy(port, 120).await {
        if let Ok(mut guard) = child.lock() {
            let _ = guard.kill();
        }
        return Err(e);
    }

    // Supervise the child: emit "dsh-exit" if it terminates unexpectedly.
    supervise(app.clone(), child.clone());

    Ok(SidecarHandle { port, child })
}

/// Forward a pipe's lines to the "dsh-log" event on a blocking thread.
fn forward_pipe<R>(pipe: R, app: AppHandle)
where
    R: Read + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            eprintln!("[sidecar] {line}");
            let _ = app.emit("dsh-log", line);
        }
    });
}

/// Poll the child until it exits, then emit "dsh-exit" with the exit code.
fn supervise(app: AppHandle, child: Arc<Mutex<Child>>) {
    tauri::async_runtime::spawn_blocking(move || loop {
        let status = child
            .lock()
            .ok()
            .and_then(|mut guard| guard.try_wait().ok().flatten());
        if let Some(status) = status {
            let _ = app.emit("dsh-exit", status.code());
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    });
}

/// Wait until the sidecar answers `GET /` with HTTP 200 on loopback (bounded retry).
async fn wait_healthy(port: u16, attempts: usize) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        let mut last: Option<usize> = None;
        for _ in 0..attempts {
            if let Some(len) = boot_manifest_len(addr) {
                // Two equal consecutive lengths mean the manifest has stopped
                // being re-composed — the client plugin set is complete.
                if last == Some(len) {
                    return Ok(());
                }
                last = Some(len);
            } else {
                last = None;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err(format!("sidecar did not become healthy on port {port}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The byte length of the injected client boot manifest, once `GET /` answers
/// 200 and the whole `window.__DSH_BOOT__` script has arrived; `None` while the
/// sidecar is still booting.
///
/// The webserver binds before the `client-modules` plugin composes the manifest,
/// and the manifest is re-composed as the remaining client plugins register, so
/// its length keeps changing until the boot settles. `wait_healthy` treats two
/// equal consecutive lengths as settled — a bare 200 (or a manifest still growing)
/// would let the shell navigate early and the web UI's first boot would then fail
/// with "N entries did not activate" (a reload succeeds).
fn boot_manifest_len(addr: std::net::SocketAddr) -> Option<usize> {
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(250)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

    let request = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request.as_bytes()).is_err() {
        return None;
    }

    let mut buf = Vec::with_capacity(16 * 1024);
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf);
                let status_ok = text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200");
                if !status_ok {
                    return None;
                }
                if let Some(start) = text.find("window.__DSH_BOOT__") {
                    if let Some(end) = text[start..].find("</script>") {
                        return Some(start + end);
                    }
                }
                if buf.len() >= 16 * 1024 {
                    return None;
                }
            }
            Err(_) => break,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{pick_port_after, MAX_PORT_PROBES};

    #[test]
    fn skips_taken_ports() {
        let taken = [3080u16, 3081].into_iter().collect();
        assert_eq!(pick_port_after(3080, &taken), 3082);
    }

    #[test]
    fn returns_first_free_port() {
        let taken = [3080u16].into_iter().collect();
        assert_eq!(pick_port_after(3080, &taken), 3081);
    }

    #[test]
    fn falls_back_to_start_when_exhausted() {
        let taken: HashSet<u16> = (0..MAX_PORT_PROBES).collect();
        assert_eq!(pick_port_after(0, &taken), 0);
    }

    #[test]
    fn skips_os_occupied_port() {
        // Occupy an ephemeral port, then assert real OS probing never returns it.
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let occupied = listener.local_addr().unwrap().port();
        let taken = HashSet::new();
        let picked = pick_port_after(occupied, &taken);
        assert_ne!(picked, occupied);
        drop(listener);
    }
}
