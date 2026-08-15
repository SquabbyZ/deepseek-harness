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

    let mut child = StdCommand::new(&node)
        .arg(&entry)
        .arg("web")
        .arg("--port")
        .arg(port.to_string())
        .env("DSH_GITHUB_CLIENT_ID", crate::config::github_client_id())
        .env("DSH_GITHUB_CLIENT_SECRET", crate::config::github_client_secret())
        .env("DSH_PRODUCT_NAME", crate::config::product_name())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

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
        for _ in 0..attempts {
            if http_status_is_200(addr) {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err(format!("sidecar did not become healthy on port {port}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Minimal raw-HTTP `GET /` over a [`TcpStream`]; true only on an HTTP 200 status
/// line, so a foreign service that happens to listen is not mistaken for ours.
fn http_status_is_200(addr: std::net::SocketAddr) -> bool {
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(250)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

    let request = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 512];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let head = String::from_utf8_lossy(&buf);
    head.lines()
        .next()
        .map(|line| line.starts_with("HTTP/1.1 200") || line.starts_with("HTTP/1.0 200"))
        .unwrap_or(false)
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
