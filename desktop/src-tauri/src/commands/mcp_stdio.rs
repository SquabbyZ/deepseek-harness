//! MCP stdio IO bridge: spawn an MCP server subprocess and exchange
//! newline-delimited JSON-RPC lines over its stdin/stdout pipes.
//!
//! All four commands share the same whitelist gate as `shell_spawn`
//! (`platform::is_shell_binary_allowed`) so the browser cannot launch
//! arbitrary executables.

use crate::error::{AppError, AppResult};
use crate::services::platform;
use crate::state::SharedState;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

/// How long `mcp_stdio_read` waits for a complete line before returning `None`.
/// Kept short so the command reads as non-blocking from the browser's point of
/// view: `Ok(None)` means "no complete line yet", and the caller may poll again.
const READ_TIMEOUT: Duration = Duration::from_millis(50);

/// Upper bound on a single line buffered from a child's stdout, in bytes.
///
/// A well-behaved MCP server emits newline-delimited lines, so anything this
/// large without a `\n` is either not a line protocol or a runaway child. Cap
/// the buffer and error out instead of letting a no-newline stream grow
/// `child.buf` without bound.
const MAX_LINE_BYTES: usize = 1024 * 1024; // 1 MiB

/// Spec for spawning an MCP stdio server process.
#[derive(Deserialize)]
pub struct McpStdioSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

/// A live stdio child plus its piped handles and a per-child line buffer.
///
/// Each child lives behind its own `Arc<Mutex<...>>` so that an in-flight
/// `read`/`write` on one connection never blocks another connection's IO.
/// `stderr` is deliberately not stored here: `mcp_stdio_spawn_inner` moves it
/// into a background drain task so a chatty server can never block on a full
/// stderr pipe.
pub struct McpStdioChild {
    pub child: tokio::process::Child,
    pub stdin: tokio::process::ChildStdin,
    pub stdout: tokio::process::ChildStdout,
    /// Bytes already read from stdout but not yet split off into a returned line.
    pub buf: Vec<u8>,
}

/// All live MCP stdio children, keyed by connection id.
pub type McpStdioChildMap = HashMap<u64, Arc<Mutex<McpStdioChild>>>;

// --- core implementations (testable without a Tauri runtime) ----------------

/// Map an underlying IO error into the bridge's `Shell` error variant.
fn map_shell_err(e: impl std::fmt::Display) -> AppError {
    AppError::Shell {
        message: e.to_string(),
    }
}

/// Read a child's stderr to EOF and discard the bytes.
///
/// The bridge's read path only consumes stdout; if stderr were left undrained,
/// a server that logs more than the OS pipe buffer (~4KB on Windows) would
/// block on write and stall the whole connection. Runs as a background task per
/// child; it ends naturally when the child is killed and stderr hits EOF.
/// Errors are reported (not swallowed) but do not fail the connection.
async fn drain_stderr(mut stderr: tokio::process::ChildStderr) -> std::io::Result<()> {
    let mut buf = [0u8; 4096];
    loop {
        match stderr.read(&mut buf).await {
            Ok(0) => return Ok(()), // EOF
            Ok(_) => continue,
            Err(e) => return Err(e),
        }
    }
}

async fn lookup(state: &SharedState, conn_id: u64) -> AppResult<Arc<Mutex<McpStdioChild>>> {
    let map = state.read().mcp_stdio.clone();
    let guard = map.lock().await;
    guard
        .get(&conn_id)
        .cloned()
        .ok_or_else(|| AppError::Internal {
            message: format!("mcp_stdio: unknown connection {conn_id}"),
        })
}

pub async fn mcp_stdio_spawn_inner(state: &SharedState, spec: McpStdioSpec) -> AppResult<u64> {
    if !platform::is_shell_binary_allowed(&spec.command) {
        return Err(AppError::PermissionDenied { cmd: spec.command });
    }
    let mut cmd = tokio::process::Command::new(&spec.command);
    cmd.args(&spec.args)
        .envs(&spec.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &spec.cwd {
        let p = PathBuf::from(cwd);
        if !p.starts_with(&state.read().config_dir) {
            return Err(AppError::PermissionDenied { cmd: spec.command });
        }
        cmd.current_dir(p);
    }
    let mut child = cmd.spawn().map_err(map_shell_err)?;
    let stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    // Drain stderr in the background so a chatty server can never fill the OS
    // pipe buffer (~4KB on Windows) and block on write — which would stall the
    // whole connection with no visible error. The task ends on its own once the
    // child is killed (stderr EOF); `mcp_stdio_close_inner` does not need to
    // track it.
    tokio::spawn(async move {
        if let Err(e) = drain_stderr(stderr).await {
            eprintln!("mcp_stdio: stderr drain failed for {:?}: {e}", spec.command);
        }
    });
    let entry = Arc::new(Mutex::new(McpStdioChild {
        child,
        stdin,
        stdout,
        buf: Vec::new(),
    }));
    let (map, seq) = {
        let st = state.read();
        (st.mcp_stdio.clone(), st.mcp_conn_seq.clone())
    };
    let conn_id = seq.fetch_add(1, Ordering::Relaxed) + 1;
    map.lock().await.insert(conn_id, entry);
    Ok(conn_id)
}

pub async fn mcp_stdio_write_inner(
    state: &SharedState,
    conn_id: u64,
    line: String,
) -> AppResult<()> {
    let entry = lookup(state, conn_id).await?;
    let mut child = entry.lock().await;
    child
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(map_shell_err)?;
    if !line.ends_with('\n') {
        child.stdin.write_all(b"\n").await.map_err(map_shell_err)?;
    }
    Ok(())
}

pub async fn mcp_stdio_read_inner(state: &SharedState, conn_id: u64) -> AppResult<Option<String>> {
    let entry = lookup(state, conn_id).await?;
    let mut child = entry.lock().await;
    // Split `child` into disjoint field borrows: `read_buf` needs a `&mut`
    // stdout and a `&mut buf` with a single unified lifetime, which the borrow
    // checker refuses through the `child` struct itself.
    let McpStdioChild { stdout, buf, .. } = &mut *child;
    loop {
        // 1. A complete line may already be buffered from a previous read.
        if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            return Ok(Some(
                String::from_utf8_lossy(&line).trim_end().to_string(),
            ));
        }
        // 1b. No newline yet — refuse to buffer an unbounded line. The check
        //     runs on every iteration (including after a large `read_buf`), so
        //     a child streaming bytes with no `\n` errors out at the cap instead
        //     of growing `buf` without bound.
        if buf.len() > MAX_LINE_BYTES {
            return Err(AppError::Internal {
                message: "mcp_stdio: line exceeds 1 MiB".to_string(),
            });
        }
        // 2. Otherwise try to read more, but do not block indefinitely.
        //    `tokio::process::ChildStdout` only implements `AsyncRead` (no
        //    `std::io::Read`), so a non-blocking `try_read_buf` is unavailable;
        //    a short `timeout` around `read_buf` gives the same caller-visible
        //    behaviour: `Ok(None)` when no complete line is available.
        match tokio::time::timeout(READ_TIMEOUT, stdout.read_buf(&mut *buf)).await {
            Ok(Ok(0)) => return Ok(None), // EOF: no complete line available
            Ok(Ok(_)) => continue,        // read more bytes; re-check for a newline
            Ok(Err(e)) => return Err(map_shell_err(e)),
            Err(_elapsed) => return Ok(None), // no complete line within the timeout
        }
    }
}

pub async fn mcp_stdio_close_inner(state: &SharedState, conn_id: u64) -> AppResult<()> {
    let map = state.read().mcp_stdio.clone();
    let entry = {
        let mut guard = map.lock().await;
        guard.remove(&conn_id)
    };
    let Some(entry) = entry else {
        return Err(AppError::Internal {
            message: format!("mcp_stdio: unknown connection {conn_id}"),
        });
    };
    let mut child = entry.lock().await;
    // Best-effort teardown: the entry is already removed from the map, so a
    // failure here only leaks the (now-unreachable) child until it exits.
    let _ = child.stdin.shutdown().await;
    let _ = child.child.kill().await;
    let _ = child.child.wait().await;
    Ok(())
}

// --- Tauri command wrappers -------------------------------------------------

#[tauri::command]
pub async fn mcp_stdio_spawn(spec: McpStdioSpec, state: State<'_, SharedState>) -> AppResult<u64> {
    mcp_stdio_spawn_inner(state.inner(), spec).await
}

#[tauri::command]
pub async fn mcp_stdio_write(
    conn_id: u64,
    line: String,
    state: State<'_, SharedState>,
) -> AppResult<()> {
    mcp_stdio_write_inner(state.inner(), conn_id, line).await
}

#[tauri::command]
pub async fn mcp_stdio_read(
    conn_id: u64,
    state: State<'_, SharedState>,
) -> AppResult<Option<String>> {
    mcp_stdio_read_inner(state.inner(), conn_id).await
}

#[tauri::command]
pub async fn mcp_stdio_close(conn_id: u64, state: State<'_, SharedState>) -> AppResult<()> {
    mcp_stdio_close_inner(state.inner(), conn_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{AppState, SharedState};
    use parking_lot::RwLock;

    fn test_state() -> SharedState {
        Arc::new(RwLock::new(AppState {
            config_dir: std::env::temp_dir(),
            dsh_home: std::env::temp_dir(),
            db: Arc::new(std::sync::Mutex::new(
                rusqlite::Connection::open_in_memory().expect("in-memory sqlite"),
            )),
            http: Arc::new(reqwest::Client::new()),
            platform: platform::Platform::current(),
            mcp_stdio: Arc::new(Mutex::new(HashMap::new())),
            mcp_conn_seq: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }))
    }

    /// Node one-liner that echoes each stdin line, prefixed with "echo:".
    /// `node.exe` is on the Windows shell whitelist (same as the real usage).
    fn echo_spec() -> McpStdioSpec {
        McpStdioSpec {
            command: "node.exe".to_string(),
            args: vec![
                "-e".to_string(),
                r#"process.stdin.on('data',d=>process.stdout.write('echo:'+d))"#.to_string(),
            ],
            env: HashMap::new(),
            cwd: None,
        }
    }

    async fn read_line_with_retry(
        state: &SharedState,
        conn: u64,
        attempts: usize,
    ) -> Option<String> {
        for _ in 0..attempts {
            if let Ok(Some(line)) = mcp_stdio_read_inner(state, conn).await {
                return Some(line);
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        None
    }

    #[tokio::test]
    async fn echo_roundtrip_spawn_write_read_close() {
        let state = test_state();
        let conn = mcp_stdio_spawn_inner(&state, echo_spec())
            .await
            .expect("spawn should succeed");
        mcp_stdio_write_inner(&state, conn, "hello".to_string())
            .await
            .expect("write should succeed");
        let line = read_line_with_retry(&state, conn, 50).await;
        assert_eq!(line.as_deref(), Some("echo:hello"));
        mcp_stdio_close_inner(&state, conn)
            .await
            .expect("close should succeed");
        assert!(
            mcp_stdio_read_inner(&state, conn).await.is_err(),
            "read after close should error because the connection is removed"
        );
    }

    #[tokio::test]
    async fn verbose_stderr_does_not_block_child() {
        let state = test_state();
        let spec = McpStdioSpec {
            command: "node.exe".to_string(),
            args: vec![
                "-e".to_string(),
                // Write ~4MB to stderr before answering stdin. Without the
                // stderr drain, the child blocks once the OS pipe buffer
                // (~4KB on Windows) fills and the round-trip below would never
                // see a reply.
                r#"for(let i=0;i<20000;i++){console.error('y'.repeat(200))};process.stdin.on('data',d=>process.stdout.write('ok:'+d))"#
                    .to_string(),
            ],
            env: HashMap::new(),
            cwd: None,
        };
        let conn = mcp_stdio_spawn_inner(&state, spec)
            .await
            .expect("spawn should succeed");
        mcp_stdio_write_inner(&state, conn, "hello".to_string())
            .await
            .expect("write should succeed");
        let line = read_line_with_retry(&state, conn, 200).await;
        assert_eq!(line.as_deref(), Some("ok:hello"));
        mcp_stdio_close_inner(&state, conn)
            .await
            .expect("close should succeed");
    }

    #[tokio::test]
    async fn spawn_rejects_non_whitelisted_binary() {
        let state = test_state();
        let spec = McpStdioSpec {
            command: "not-allowed.exe".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
        };
        let err = mcp_stdio_spawn_inner(&state, spec)
            .await
            .expect_err("spawn should be denied");
        assert!(matches!(err, AppError::PermissionDenied { .. }));
    }

    #[tokio::test]
    async fn read_unknown_connection_is_error() {
        let state = test_state();
        let err = mcp_stdio_read_inner(&state, 4242)
            .await
            .expect_err("read of unknown conn should error");
        assert!(matches!(err, AppError::Internal { .. }));
    }

    #[tokio::test]
    async fn write_unknown_connection_is_error() {
        let state = test_state();
        let err = mcp_stdio_write_inner(&state, 4242, "hello".to_string())
            .await
            .expect_err("write of unknown conn should error");
        assert!(matches!(err, AppError::Internal { .. }));
    }

    #[tokio::test]
    async fn close_unknown_connection_is_error() {
        let state = test_state();
        let err = mcp_stdio_close_inner(&state, 4242)
            .await
            .expect_err("close of unknown conn should error");
        assert!(matches!(err, AppError::Internal { .. }));
    }

    #[tokio::test]
    async fn spawn_rejects_cwd_outside_config_dir() {
        let state = test_state();
        // test_state() sets config_dir to the system temp dir; the repo working
        // dir is guaranteed not to live under it.
        let spec = McpStdioSpec {
            command: "node.exe".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: Some(
                std::env::current_dir()
                    .expect("current dir")
                    .to_string_lossy()
                    .into_owned(),
            ),
        };
        let err = mcp_stdio_spawn_inner(&state, spec)
            .await
            .expect_err("cwd outside config_dir should be denied");
        assert!(matches!(err, AppError::PermissionDenied { .. }));
    }

    #[tokio::test]
    async fn partial_line_accumulates_across_reads() {
        let state = test_state();
        let spec = McpStdioSpec {
            command: "node.exe".to_string(),
            args: vec![
                "-e".to_string(),
                // Write a partial line immediately, then complete it ~50ms later
                // so the first read times out with the fragment still buffered.
                r#"process.stdout.write('partial');setTimeout(()=>process.stdout.write('complete\n'),50)"#
                    .to_string(),
            ],
            env: HashMap::new(),
            cwd: None,
        };
        let conn = mcp_stdio_spawn_inner(&state, spec)
            .await
            .expect("spawn should succeed");
        // The fragment carries no newline, so the first read returns Ok(None)
        // and the bytes stay in the child's buffer for a later read.
        let first = mcp_stdio_read_inner(&state, conn)
            .await
            .expect("read should not fail");
        assert_eq!(first, None, "partial line should buffer, not be returned");
        // Subsequent reads eventually see the completed line.
        let line = read_line_with_retry(&state, conn, 100).await;
        assert_eq!(line.as_deref(), Some("partialcomplete"));
        mcp_stdio_close_inner(&state, conn)
            .await
            .expect("close should succeed");
    }

    #[tokio::test]
    async fn oversized_line_without_newline_is_error() {
        let state = test_state();
        let spec = McpStdioSpec {
            command: "node.exe".to_string(),
            args: vec![
                "-e".to_string(),
                // One giant line with no newline, well over the 1 MiB cap; the
                // read path must stop buffering and error instead of growing
                // the buffer forever.
                r#"process.stdout.write('x'.repeat(2*1024*1024))"#.to_string(),
            ],
            env: HashMap::new(),
            cwd: None,
        };
        let conn = mcp_stdio_spawn_inner(&state, spec)
            .await
            .expect("spawn should succeed");
        let mut err = None;
        for _ in 0..100 {
            match mcp_stdio_read_inner(&state, conn).await {
                Ok(Some(_)) => panic!("oversized stream produced a line"),
                Ok(None) => tokio::time::sleep(Duration::from_millis(10)).await,
                Err(e) => {
                    err = Some(e);
                    break;
                }
            }
        }
        let err = err.expect("oversized line should eventually error");
        assert!(matches!(err, AppError::Internal { .. }));
        mcp_stdio_close_inner(&state, conn)
            .await
            .expect("close should succeed");
    }
}
