use serde_json::Value;
use sqlx::SqlitePool;
use tokio::sync::mpsc::UnboundedSender;

use crate::infra::secrets::SecretsStore;

#[derive(Debug)]
pub struct EventMsg {
    pub name: String,
    pub data: Value,
}

pub struct AppState {
    pub db: SqlitePool,
    pub http: reqwest::Client,
    pub secrets: SecretsStore,
    pub events: UnboundedSender<EventMsg>,
}

impl AppState {
    pub fn new(db: SqlitePool, events: UnboundedSender<EventMsg>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("personal-assistant-core/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client");
        Self {
            db,
            http,
            secrets: SecretsStore::new(),
            events,
        }
    }

    pub fn emit(&self, name: impl Into<String>, data: Value) {
        let _ = self.events.send(EventMsg {
            name: name.into(),
            data,
        });
    }
}
