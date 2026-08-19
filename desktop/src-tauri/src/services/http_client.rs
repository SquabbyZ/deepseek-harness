use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

use crate::error::{AppError, AppResult};

#[derive(Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<Vec<u8>>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub async fn execute(client: &reqwest::Client, req: HttpRequest) -> AppResult<HttpResponse> {
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| {
        AppError::Internal {
            message: format!("bad method: {e}"),
        }
    })?;

    let mut builder = client.request(method, &req.url);

    let mut header_map = HeaderMap::new();
    for (k, v) in req.headers {
        let name = HeaderName::from_bytes(k.as_bytes()).map_err(|e| AppError::Internal {
            message: format!("bad header name: {e}"),
        })?;
        let value = HeaderValue::from_bytes(v.as_bytes()).map_err(|e| AppError::Internal {
            message: format!("bad header value: {e}"),
        })?;
        header_map.insert(name, value);
    }
    builder = builder.headers(header_map);

    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    if let Some(timeout_ms) = req.timeout_ms {
        builder = builder.timeout(Duration::from_millis(timeout_ms));
    }

    let resp = builder.send().await?;
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers() {
        headers.insert(k.to_string(), v.to_str().unwrap_or("").to_string());
    }
    let body = resp.bytes().await?;
    Ok(HttpResponse {
        status,
        headers,
        body: body.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .build()
            .expect("test client builds")
    }

    #[tokio::test]
    async fn bad_method_returns_internal_error() {
        let req = HttpRequest {
            method: "BAD METHOD".into(),
            url: "http://127.0.0.1:1/".into(),
            headers: HashMap::new(),
            body: None,
            timeout_ms: None,
        };
        assert!(matches!(
            execute(&client(), req).await,
            Err(AppError::Internal { .. })
        ));
    }

    #[tokio::test]
    async fn bad_header_name_returns_internal_error() {
        let mut headers = HashMap::new();
        headers.insert("bad header\n".into(), "v".into());
        let req = HttpRequest {
            method: "GET".into(),
            url: "http://127.0.0.1:1/".into(),
            headers,
            body: None,
            timeout_ms: None,
        };
        assert!(matches!(
            execute(&client(), req).await,
            Err(AppError::Internal { .. })
        ));
    }

    #[tokio::test]
    async fn bad_header_value_returns_internal_error() {
        let mut headers = HashMap::new();
        headers.insert("x-ok".into(), "bad value\n".into());
        let req = HttpRequest {
            method: "GET".into(),
            url: "http://127.0.0.1:1/".into(),
            headers,
            body: None,
            timeout_ms: None,
        };
        assert!(matches!(
            execute(&client(), req).await,
            Err(AppError::Internal { .. })
        ));
    }
}