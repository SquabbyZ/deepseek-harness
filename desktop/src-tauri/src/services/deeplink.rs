use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Deserialize, Serialize, Debug)]
#[serde(tag = "kind")]
pub enum ParsedDeeplink {
    Install {
        spec: String,
        name: Option<String>,
    },
    Import {
        resource: String,
        config: serde_json::Value,
    },
}

/// Parse a `dsh:/v1/...` deep link. Scheme is non-special so the path
/// component starts at the first character after `dsh:`. Two paths are
/// recognised: `/v1/install` (with required `spec`, optional `name`) and
/// `/v1/import` (with required `resource` from a strict allowlist and
/// required `config` JSON payload).
pub fn parse(url: &str) -> AppResult<ParsedDeeplink> {
    let parsed = Url::parse(url).map_err(|e| AppError::DeeplinkParse {
        url: url.to_string(),
        reason: e.to_string(),
    })?;
    if parsed.scheme() != "dsh" {
        return Err(AppError::DeeplinkParse {
            url: url.to_string(),
            reason: format!("scheme must be dsh://, got {}", parsed.scheme()),
        });
    }
    match parsed.path() {
        "/v1/install" => {
            let spec = parsed
                .query_pairs()
                .find(|(k, _)| k == "spec")
                .map(|(_, v)| v.into_owned())
                .ok_or_else(|| AppError::DeeplinkParse {
                    url: url.to_string(),
                    reason: "missing spec".into(),
                })?;
            let name = parsed
                .query_pairs()
                .find(|(k, _)| k == "name")
                .map(|(_, v)| v.into_owned());
            Ok(ParsedDeeplink::Install { spec, name })
        }
        "/v1/import" => {
            let resource = parsed
                .query_pairs()
                .find(|(k, _)| k == "resource")
                .map(|(_, v)| v.into_owned())
                .ok_or_else(|| AppError::DeeplinkParse {
                    url: url.to_string(),
                    reason: "missing resource".into(),
                })?;
            if !matches!(resource.as_str(), "plugin" | "skill" | "mcp" | "agent") {
                return Err(AppError::DeeplinkParse {
                    url: url.to_string(),
                    reason: format!("unknown resource {resource}"),
                });
            }
            let cfg_str = parsed
                .query_pairs()
                .find(|(k, _)| k == "config")
                .map(|(_, v)| v.into_owned())
                .ok_or_else(|| AppError::DeeplinkParse {
                    url: url.to_string(),
                    reason: "missing config".into(),
                })?;
            let config: serde_json::Value = serde_json::from_str(&cfg_str).map_err(|e| {
                AppError::DeeplinkParse {
                    url: url.to_string(),
                    reason: format!("bad config json: {e}"),
                }
            })?;
            Ok(ParsedDeeplink::Import { resource, config })
        }
        _ => Err(AppError::DeeplinkParse {
            url: url.to_string(),
            reason: format!("unknown path {}", parsed.path()),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_install_deeplink() {
        let parsed = parse("dsh:/v1/install?spec=hello&name=myapp").unwrap();
        match parsed {
            ParsedDeeplink::Install { spec, name } => {
                assert_eq!(spec, "hello");
                assert_eq!(name.as_deref(), Some("myapp"));
            }
            _ => panic!("expected Install"),
        }
    }

    #[test]
    fn parses_install_deeplink_without_name() {
        let parsed = parse("dsh:/v1/install?spec=hello").unwrap();
        match parsed {
            ParsedDeeplink::Install { spec, name } => {
                assert_eq!(spec, "hello");
                assert_eq!(name, None);
            }
            _ => panic!("expected Install"),
        }
    }

    #[test]
    fn install_requires_spec() {
        let result = parse("dsh:/v1/install?name=myapp");
        assert!(matches!(result, Err(AppError::DeeplinkParse { .. })));
    }

    #[test]
    fn parses_import_deeplink() {
        // config is JSON-encoded in the query: {"k":1}
        let url = "dsh:/v1/import?resource=plugin&config=%7B%22k%22%3A1%7D";
        let parsed = parse(url).unwrap();
        match parsed {
            ParsedDeeplink::Import { resource, config } => {
                assert_eq!(resource, "plugin");
                assert_eq!(config["k"], 1);
            }
            _ => panic!("expected Import"),
        }
    }

    #[test]
    fn import_accepts_all_allowed_resources() {
        for resource in ["plugin", "skill", "mcp", "agent"] {
            let url = format!("dsh:/v1/import?resource={resource}&config=%7B%7D");
            let parsed = parse(&url).unwrap_or_else(|e| {
                panic!("resource {resource} should be allowed: {e:?}");
            });
            assert!(matches!(parsed, ParsedDeeplink::Import { .. }));
        }
    }

    #[test]
    fn rejects_unknown_resource() {
        let result = parse("dsh:/v1/import?resource=unknown&config=%7B%7D");
        assert!(matches!(result, Err(AppError::DeeplinkParse { .. })));
    }

    #[test]
    fn rejects_wrong_scheme() {
        let result = parse("https:/v1/install?spec=x");
        assert!(matches!(result, Err(AppError::DeeplinkParse { .. })));
    }

    #[test]
    fn rejects_unknown_path() {
        let result = parse("dsh:/v2/install?spec=x");
        assert!(matches!(result, Err(AppError::DeeplinkParse { .. })));
    }

    #[test]
    fn rejects_invalid_url() {
        let result = parse("not a url at all");
        assert!(matches!(result, Err(AppError::DeeplinkParse { .. })));
    }

    #[test]
    fn rejected_deeplinks_are_serializable_as_errors() {
        // The error tag must survive round-tripping through serde so the
        // frontend can branch on `code: "DeeplinkParse"`.
        let err = parse("dsh:/v2/install?spec=x").unwrap_err();
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("DeeplinkParse"));
    }
}