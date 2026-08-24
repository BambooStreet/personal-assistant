pub mod cost;
pub mod dispatch;
pub mod openai;
pub mod tools;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::infra::secrets::SecretsStore;

/// LLM 호출 seam. 프로덕션은 `OpenAiAdapter`, 테스트는 미리 정해둔 응답을 뱉는 가짜.
///
/// 이 trait가 있어야 `run_agent_loop`(도구 루프·confirm 반환·orphan 정리)를 네트워크 없이
/// 검증할 수 있다. 엔드포인트가 상수로 박혀 있던 동안 그쪽 테스트는 0개였다 — D-024.
#[async_trait::async_trait]
pub trait LlmClient: Send + Sync {
    async fn chat(&self, secrets: &SecretsStore, req: ChatRequest) -> AppResult<ChatResponse>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    Stop,
    ToolCalls,
    Length,
    ContentFilter,
    Other,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub tools: Vec<ToolDef>,
    #[serde(default)]
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub message: ChatMessage,
    pub finish_reason: FinishReason,
    pub usage: Usage,
    pub model: String,
}
