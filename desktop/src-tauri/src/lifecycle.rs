//! Sidecar lifecycle: port selection, spawn, health polling, graceful shutdown.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpStream;
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

pub const DEFAULT_PORT: u16 = 3080;
pub const MAX_PORT_PROBES: u16 = 32;

/// Lowest free port at or after `start`, skipping `taken`.
///
/// Probes at most [`MAX_PORT_PROBES`] ports; falls back to `start` if all are taken.
pub fn pick_port_after(start: u16, taken: &HashSet<u16>) -> u16 {
    let mut port = start;
    for _ in 0..MAX_PORT_PROBES {
        if !taken.contains(&port) {
            return port;
        }
        port = port.wrapping_add(1);
    }
    start
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
    let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
    let entry = runtime.join("dsh").join("lib").join("bin.js");

    let mut child = StdCommand::new(&node)
        .arg(&entry)
        .arg("web")
        .arg("--port")
        .arg(port.to_string())
        .env(
            "DSH_GITHUB_CLIENT_ID",
            std::env::var("DSH_GITHUB_CLIENT_ID").unwrap_or_default(),
        )
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

/// Wait until the sidecar answers on loopback (bounded retry).
async fn wait_healthy(port: u16, attempts: usize) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        for _ in 0..attempts {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err(format!("sidecar did not become healthy on port {port}"))
    })
    .await
    .map_err(|e| e.to_string())?
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
}
