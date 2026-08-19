use crate::error::AppResult;
use crate::services::deeplink::{self, ParsedDeeplink};
use crate::state::SharedState;
use tauri::State;

#[tauri::command]
pub fn deeplink_parse(url: String) -> AppResult<ParsedDeeplink> {
    deeplink::parse(&url)
}

#[tauri::command]
pub fn deeplink_import(
    parsed: ParsedDeeplink,
    _state: State<'_, SharedState>,
) -> AppResult<serde_json::Value> {
    // Phase 1: stub echoes the parsed payload. Phase 2 (S4) will wire this
    // to plugin_install / skill_install / etc.
    Ok(serde_json::json!({ "parsed": parsed }))
}