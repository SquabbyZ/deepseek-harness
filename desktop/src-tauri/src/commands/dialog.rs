use crate::error::AppResult;
use serde::Deserialize;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Deserialize)]
pub struct OpenOpts {
    #[serde(default)]
    pub directory: bool,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Deserialize)]
pub struct Filter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Deserialize)]
pub struct SaveOpts {
    pub default_name: Option<String>,
    pub filters: Vec<Filter>,
}

#[derive(Deserialize)]
pub struct MsgOpts {
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[tauri::command]
pub async fn dialog_open(opts: OpenOpts, app: tauri::AppHandle) -> AppResult<Option<String>> {
    let title = opts.title;
    let directory = opts.directory;
    let filters = opts.filters;
    let path = tokio::task::spawn_blocking(move || {
        let mut builder = app.dialog().file();
        if let Some(t) = title {
            builder = builder.set_title(t);
        }
        // `add_filter` is the only public way to push filters onto the
        // builder; it accepts `&[&str]` extensions. We translate our
        // owned `Vec<String>` into borrowed slices for the call.
        for filter in filters {
            let ext_refs: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(filter.name, &ext_refs);
        }
        if directory {
            builder.blocking_pick_folder()
        } else {
            builder.blocking_pick_file()
        }
        .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten();
    Ok(path)
}

#[tauri::command]
pub async fn dialog_save(opts: SaveOpts, app: tauri::AppHandle) -> AppResult<Option<String>> {
    let filters = opts.filters;
    let default_name = opts.default_name.unwrap_or_else(|| "untitled".into());
    let path = tokio::task::spawn_blocking(move || {
        let mut builder = app.dialog().file().set_file_name(default_name);
        for filter in filters {
            let ext_refs: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(filter.name, &ext_refs);
        }
        builder.blocking_save_file().map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten();
    Ok(path)
}

#[tauri::command]
pub async fn dialog_message(opts: MsgOpts, app: tauri::AppHandle) -> AppResult<()> {
    let kind = match opts.kind.as_str() {
        "warn" => tauri_plugin_dialog::MessageDialogKind::Warning,
        "error" => tauri_plugin_dialog::MessageDialogKind::Error,
        _ => tauri_plugin_dialog::MessageDialogKind::Info,
    };
    let text = opts.text;
    let title = opts.title.unwrap_or_else(|| "DeepSeek Harness".into());
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .message(text)
            .title(title)
            .kind(kind)
            .buttons(MessageDialogButtons::Ok)
            .blocking_show();
    })
    .await
    .ok();
    Ok(())
}