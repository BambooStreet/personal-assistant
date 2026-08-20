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

    /// 테스트 전용 — 비밀값 백엔드를 주입한다.
    ///
    /// `new()`는 `SecretsStore::new()`를 하드코딩하는데 그건 Windows/macOS에서 실제 OS
    /// 키체인을 읽는다. 테스트에서 그대로 쓰면 개발 PC의 진짜 API 키를 집어 네트워크를 때린다.
    #[cfg(test)]
    pub fn new_for_test(
        db: SqlitePool,
        events: UnboundedSender<EventMsg>,
        secrets: SecretsStore,
    ) -> Self {
        Self {
            db,
            http: reqwest::Client::new(),
            secrets,
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
