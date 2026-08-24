use std::sync::Arc;

use serde_json::Value;
use sqlx::SqlitePool;
use tokio::sync::mpsc::UnboundedSender;

use crate::infra::secrets::SecretsStore;
use crate::services::llm::LlmClient;

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
    /// LLM 호출 seam. 테스트는 여기에 가짜를 꽂아 네트워크 없이 agent loop을 돌린다(D-024).
    pub llm: Arc<dyn LlmClient>,
}

impl AppState {
    pub fn new(db: SqlitePool, events: UnboundedSender<EventMsg>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("personal-assistant-core/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client");
        let llm = Arc::new(crate::services::llm::openai::OpenAiAdapter::new(
            http.clone(),
        ));
        Self {
            db,
            http,
            secrets: SecretsStore::new(),
            events,
            llm,
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
        llm: Arc<dyn LlmClient>,
    ) -> Self {
        Self {
            db,
            http: reqwest::Client::new(),
            secrets,
            events,
            llm,
        }
    }

    pub fn emit(&self, name: impl Into<String>, data: Value) {
        let _ = self.events.send(EventMsg {
            name: name.into(),
            data,
        });
    }
}
