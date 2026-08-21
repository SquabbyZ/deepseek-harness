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