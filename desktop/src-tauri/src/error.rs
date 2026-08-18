use serde::Serialize;

#[derive(thiserror::Error, Debug, Serialize)]
#[serde(tag = "code", content = "detail")]
pub enum AppError {
    #[error("Internal error: {message}")]
    Internal { message: String },
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Internal {
            message: format!("db: {e}"),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Internal {
            message: format!("io: {e}"),
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Internal {
            message: format!("http: {e}"),
        }
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Internal {
            message: format!("keyring: {e}"),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
