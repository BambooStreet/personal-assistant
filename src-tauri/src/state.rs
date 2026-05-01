use sqlx::SqlitePool;

use crate::infra::secrets::SecretsStore;

pub struct AppState {
    pub db: SqlitePool,
    pub http: reqwest::Client,
    pub secrets: SecretsStore,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!(
                "personal-assistant/",
                env!("CARGO_PKG_VERSION"),
            ))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client");

        Self {
            db,
            http,
            secrets: SecretsStore::new(),
        }
    }
}
