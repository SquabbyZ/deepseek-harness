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