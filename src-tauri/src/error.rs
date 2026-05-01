use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("unauthorized: {0}")]
    Unauthorized(String),

    #[error("external service error: {0}")]
    External(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&mask_secrets(&self.to_string()))
    }
}

fn mask_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == 's' && chars.peek() == Some(&'k') {
            out.push_str("sk-***");
            for c2 in chars.by_ref() {
                if c2.is_whitespace() || c2 == '"' || c2 == '\'' {
                    out.push(c2);
                    break;
                }
            }
        } else if c == 'B' && input[..].contains("Bearer") {
            out.push(c);
        } else {
            out.push(c);
        }
    }
    out
}

pub type AppResult<T> = Result<T, AppError>;
