use std::sync::Arc;
use tauri::State;

use crate::error::AppResult;
use crate::services::http_client::{self, HttpRequest, HttpResponse};
use crate::state::SharedState;

#[tauri::command]
pub async fn http_request(
    req: HttpRequest,
    state: State<'_, SharedState>,
) -> AppResult<HttpResponse> {
    let client: Arc<reqwest::Client> = {
        let s = state.read();
        Arc::clone(&s.http)
    };
    http_client::execute(&client, req).await
}

/**
 * Swap the shared HTTP client to honor a new outbound proxy (`None` clears it).
 * The client settings panel persists `proxy.url` and calls this at runtime so
 * the reqwest client (real-LLM chat, plugin fetches) routes through the proxy
 * without a restart.
 */
#[tauri::command]
pub fn http_set_proxy(url: Option<String>, state: State<'_, SharedState>) -> AppResult<()> {
    let builder = reqwest::Client::builder()
        .user_agent(concat!("DeepSeek-Harness/", env!("CARGO_PKG_VERSION")));
    let client = match url.as_deref() {
        Some(raw) if !raw.trim().is_empty() => {
            let proxy = reqwest::Proxy::all(raw).map_err(|e| {
                crate::error::AppError::Internal { message: format!("bad proxy url: {e}") }
            })?;
            builder.proxy(proxy).build().map_err(crate::error::AppError::from)?
        }
        _ => builder.build().map_err(crate::error::AppError::from)?,
    };
    let mut s = state.write();
    s.http = Arc::new(client);
    Ok(())
}
/** Result of one proxy connectivity probe. */
#[derive(serde::Serialize)]
pub struct ProxyTestResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/**
 * Probe an outbound proxy by opening a TCP connection and issuing a CONNECT
 * tunnel request to a known host. A 200 reply means the proxy can carry HTTPS.
 * The browser cannot open raw sockets, so this lives on the Rust side.
 */
#[tauri::command]
pub async fn proxy_test(url: String) -> ProxyTestResult {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use std::time::Instant;
    let clean = url.trim();
    let host_port = clean
        .strip_prefix("http://").or_else(|| clean.strip_prefix("https://"))
        .unwrap_or(clean);
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().ok()),
        None => (host_port, None),
    };
    if host.is_empty() || port.is_none() {
        return ProxyTestResult { ok: false, latency_ms: None, error: Some(format!("invalid proxy url: {clean}")) };
    }
    let started = Instant::now();
    let mut stream = match tokio::net::TcpStream::connect((host, port.unwrap())).await {
        Ok(s) => s,
        Err(e) => return ProxyTestResult { ok: false, latency_ms: None, error: Some(format!("connect {host}:{} — {e}", port.unwrap())) },
    };
    if let Err(e) = stream.write_all(b"CONNECT raw.githubusercontent.com:443 HTTP/1.1\r\nHost: raw.githubusercontent.com:443\r\n\r\n").await {
        return ProxyTestResult { ok: false, latency_ms: None, error: Some(format!("write — {e}")) };
    }
    let mut buf = [0u8; 64];
    let n = match stream.read(&mut buf).await {
        Ok(n) => n,
        Err(e) => return ProxyTestResult { ok: false, latency_ms: None, error: Some(format!("read — {e}")) },
    };
    let head = String::from_utf8_lossy(&buf[..n]);
    let ok = head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200");
    ProxyTestResult {
        ok,
        latency_ms: Some(started.elapsed().as_millis() as u64),
        error: if ok { None } else { Some(format!("proxy replied: {}", head.lines().next().unwrap_or("?")).trim().to_string()) },
    }
}
