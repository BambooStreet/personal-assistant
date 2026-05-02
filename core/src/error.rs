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

impl AppError {
    /// JSON-RPC 에러 코드로 매핑.
    pub fn rpc_code(&self) -> i32 {
        match self {
            AppError::InvalidInput(_) => -32602,
            AppError::Unauthorized(_) => -32001,
            AppError::NotFound(_) => -32004,
            AppError::External(_) => -32010,
            AppError::Db(_) | AppError::Migrate(_) => -32011,
            _ => -32603,
        }
    }
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
        } else {
            out.push(c);
        }
    }
    out
}

pub type AppResult<T> = Result<T, AppError>;
