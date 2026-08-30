//! DB 테스트 하네스 — 메모리 SQLite + 마이그레이션 + `AppState` 조립.
//!
//! 이걸로 `&AppState`를 받는 진짜 함수(커맨드/서비스)를 테스트할 수 있다. 순수 함수만
//! 검증하던 기존 테스트로는 못 잡던 것들 — 테넌시 격리, 캐스케이드 삭제, 디듑, 이벤트
//! 발화 — 이 대상이다.
//!
//! 새 도메인에서도 그대로 재사용할 것.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::mpsc::{self, UnboundedReceiver};

use crate::error::{AppError, AppResult};
use crate::infra::secrets::{SecretKey, SecretsBackend, SecretsStore};
use crate::services::llm::{
    ChatMessage, ChatRequest, ChatResponse, FinishReason, LlmClient, Role, ToolCall, Usage,
};
use crate::state::{AppState, EventMsg};

/// 항상 비어 있는 비밀값 백엔드.
///
/// ⚠️ **이게 하네스의 핵심 안전장치다.** `SecretsStore::new()`는 Windows/macOS에서
/// `KeyringBackend`(실제 OS 자격 증명 저장소)를 고른다. 주입하지 않으면 `cargo test`가
/// 개발 PC의 진짜 OpenAI 키를 찾아 **테스트 중에 실제 API를 호출**한다.
struct EmptySecrets;

impl SecretsBackend for EmptySecrets {
    fn get(&self, _key: SecretKey) -> AppResult<Option<String>> {
        Ok(None)
    }
    fn set(&self, _key: SecretKey, _value: &str) -> AppResult<()> {
        Ok(())
    }
    fn delete(&self, _key: SecretKey) -> AppResult<()> {
        Ok(())
    }
}

/// OpenAI 키만 **있는 것처럼** 보이는 백엔드.
///
/// `EmptySecrets`로는 "키가 없으면 폴백" 분기만 밟혀서 LLM 경로를 아예 못 탄다.
/// 실제 네트워크는 `FakeLlm`이 막으므로 키 문자열은 아무 값이나 상관없다.
struct KeyedSecrets;

impl SecretsBackend for KeyedSecrets {
    fn get(&self, key: SecretKey) -> AppResult<Option<String>> {
        Ok(match key {
            SecretKey::OpenAiApiKey => Some("test-key".into()),
            _ => None,
        })
    }
    fn set(&self, _key: SecretKey, _value: &str) -> AppResult<()> {
        Ok(())
    }
    fn delete(&self, _key: SecretKey) -> AppResult<()> {
        Ok(())
    }
}

/// 빈 메모리 DB + 마이그레이션 전부 적용된 `AppState`.
///
/// 반환하는 `UnboundedReceiver`로 `state.emit(...)`이 실제로 나갔는지 검증한다 —
/// 이걸 떨어뜨리면 채널이 닫히니 테스트 끝까지 들고 있을 것.
pub async fn test_state() -> (AppState, UnboundedReceiver<EventMsg>) {
    let (state, rx, _) = test_state_with_llm(Vec::new()).await;
    (state, rx)
}

/// `test_state()` + 대본대로 응답하는 가짜 LLM. **키는 없는 상태**라 키 유무를 보는
/// 경로(브리핑·인사·루틴 알림)는 폴백으로 빠진다 — LLM까지 태우려면
/// [`test_state_with_llm_and_key`]를 쓸 것.
///
/// `script`는 **호출 순서대로** 소비된다 — agent loop이 iteration을 돌면 다음 응답이 나간다.
/// 대본이 떨어진 상태에서 또 부르면 에러다(조용히 통과하면 "몇 번 불렸는지"를 못 잡는다).
pub async fn test_state_with_llm(
    script: Vec<ChatResponse>,
) -> (AppState, UnboundedReceiver<EventMsg>, Arc<FakeLlm>) {
    build_state(script, Box::new(EmptySecrets)).await
}

/// `test_state_with_llm()` + OpenAI 키가 설정된 것처럼 보이는 상태.
pub async fn test_state_with_llm_and_key(
    script: Vec<ChatResponse>,
) -> (AppState, UnboundedReceiver<EventMsg>, Arc<FakeLlm>) {
    build_state(script, Box::new(KeyedSecrets)).await
}

async fn build_state(
    script: Vec<ChatResponse>,
    secrets: Box<dyn SecretsBackend>,
) -> (AppState, UnboundedReceiver<EventMsg>, Arc<FakeLlm>) {
    // ⚠️ max_connections(1) 필수. `sqlite::memory:`는 **커넥션마다 별개의 DB**라
    // 풀이 2개 이상이면 A에 쓴 걸 B가 못 본다.
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("메모리 DB 연결");

    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("마이그레이션");

    let (tx, rx) = mpsc::unbounded_channel();
    let llm = Arc::new(FakeLlm::new(script));
    let state = AppState::new_for_test(db, tx, SecretsStore::with_backend(secrets), llm.clone());
    (state, rx, llm)
}

/// 대본대로 답하는 가짜 LLM. 받은 요청을 전부 보관해 "무엇이 프롬프트에 실렸는지"도 검증한다.
pub struct FakeLlm {
    script: Mutex<VecDeque<ChatResponse>>,
    requests: Mutex<Vec<ChatRequest>>,
}

impl FakeLlm {
    pub fn new(script: Vec<ChatResponse>) -> Self {
        Self {
            script: Mutex::new(script.into()),
            requests: Mutex::new(Vec::new()),
        }
    }

    /// LLM이 몇 번 불렸는지. agent loop의 iteration 수와 같다.
    pub fn call_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }

    /// n번째(0-base) 호출에 실린 메시지들. 표시 지침 주입·orphan 정리 검증용.
    pub fn request(&self, n: usize) -> ChatRequest {
        self.requests.lock().unwrap()[n].clone()
    }
}

#[async_trait::async_trait]
impl LlmClient for FakeLlm {
    async fn chat(&self, _secrets: &SecretsStore, req: ChatRequest) -> AppResult<ChatResponse> {
        self.requests.lock().unwrap().push(req);
        self.script
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| AppError::External("FakeLlm: 대본 소진 — 예상보다 많이 호출됨".into()))
    }
}

fn response(content: Option<&str>, tool_calls: Option<Vec<ToolCall>>) -> ChatResponse {
    let finish_reason = if tool_calls.is_some() {
        FinishReason::ToolCalls
    } else {
        FinishReason::Stop
    };
    ChatResponse {
        message: ChatMessage {
            role: Role::Assistant,
            content: content.map(str::to_string),
            tool_calls,
            tool_call_id: None,
            name: None,
        },
        finish_reason,
        usage: Usage {
            input_tokens: 10,
            output_tokens: 5,
        },
        model: "fake-model".into(),
    }
}

/// 텍스트만 있는 응답 — agent loop이 여기서 종료한다.
pub fn llm_text(text: &str) -> ChatResponse {
    response(Some(text), None)
}

/// 텍스트도 tool_call도 없는 응답. 렌더러가 말풍선을 지워버리는 그 경로를 재현한다.
pub fn llm_empty() -> ChatResponse {
    response(None, None)
}

/// tool_call 응답. `args`는 도구 인자 JSON.
pub fn llm_tool_call(id: &str, name: &str, args: serde_json::Value) -> ChatResponse {
    response(
        None,
        Some(vec![ToolCall {
            id: id.into(),
            name: name.into(),
            arguments: args,
        }]),
    )
}

/// 한 응답에 tool_call 여러 개 — prefix 자르기 규칙 검증용.
pub fn llm_tool_calls(calls: Vec<(&str, &str, serde_json::Value)>) -> ChatResponse {
    response(
        None,
        Some(
            calls
                .into_iter()
                .map(|(id, name, arguments)| ToolCall {
                    id: id.into(),
                    name: name.into(),
                    arguments,
                })
                .collect(),
        ),
    )
}

/// 테넌시 테스트용 추가 유저. `users`에 행이 있어야 스케줄러가 순회한다.
pub async fn add_user(state: &AppState, id: i64, handle: &str) {
    sqlx::query("INSERT INTO users (id, handle, created_at) VALUES (?, ?, '2026-01-01T00:00:00Z')")
        .bind(id)
        .bind(handle)
        .execute(&state.db)
        .await
        .expect("유저 추가");
}

pub async fn set_setting(state: &AppState, user_id: i64, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z') \
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
    )
    .bind(user_id)
    .bind(key)
    .bind(value)
    .execute(&state.db)
    .await
    .expect("설정 저장");
}

pub async fn count(state: &AppState, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(&state.db)
        .await
        .expect("count")
}
