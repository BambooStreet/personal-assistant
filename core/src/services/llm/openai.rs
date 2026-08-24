use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::{SecretKey, SecretsStore};

use super::{
    ChatMessage, ChatRequest, ChatResponse, FinishReason, LlmClient, Role, ToolCall, Usage,
};

const ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";

pub struct OpenAiAdapter {
    http: reqwest::Client,
}

impl OpenAiAdapter {
    pub fn new(http: reqwest::Client) -> Self {
        Self { http }
    }

    fn api_key(secrets: &SecretsStore) -> AppResult<String> {
        secrets
            .get(SecretKey::OpenAiApiKey)?
            .ok_or_else(|| AppError::Unauthorized("OpenAI API key not set".into()))
    }
}

#[async_trait::async_trait]
impl LlmClient for OpenAiAdapter {
    async fn chat(&self, secrets: &SecretsStore, req: ChatRequest) -> AppResult<ChatResponse> {
        self.chat_with_secrets(secrets, req).await
    }
}

impl OpenAiAdapter {
    #[tracing::instrument(skip_all, fields(model = %req.model, msg_count = req.messages.len()))]
    pub async fn chat_with_secrets(
        &self,
        secrets: &SecretsStore,
        req: ChatRequest,
    ) -> AppResult<ChatResponse> {
        let key = Self::api_key(secrets)?;

        let body = build_request_body(&req);
        tracing::debug!("openai request prepared");

        let resp = self
            .http
            .post(ENDPOINT)
            .bearer_auth(&key)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let raw = resp.text().await?;

        if !status.is_success() {
            tracing::warn!(status = %status, "openai api error");
            let detail = serde_json::from_str::<OpenAiErrorBody>(&raw)
                .map(|b| b.error.message)
                .unwrap_or_else(|_| raw.chars().take(500).collect());
            return Err(AppError::External(format!("OpenAI {status}: {detail}")));
        }

        let parsed: OpenAiChatResponse = serde_json::from_str(&raw)?;
        let choice = parsed
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| AppError::External("OpenAI returned no choices".into()))?;

        let finish_reason = match choice.finish_reason.as_deref() {
            Some("stop") => FinishReason::Stop,
            Some("tool_calls") => FinishReason::ToolCalls,
            Some("length") => FinishReason::Length,
            Some("content_filter") => FinishReason::ContentFilter,
            _ => FinishReason::Other,
        };

        let tool_calls = choice
            .message
            .tool_calls
            .map(|calls| {
                calls
                    .into_iter()
                    .map(|c| {
                        let arguments: Value =
                            serde_json::from_str(&c.function.arguments).unwrap_or(Value::Null);
                        ToolCall {
                            id: c.id,
                            name: c.function.name,
                            arguments,
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .filter(|v| !v.is_empty());

        let message = ChatMessage {
            role: Role::Assistant,
            content: choice.message.content,
            tool_calls,
            tool_call_id: None,
            name: None,
        };

        let usage = Usage {
            input_tokens: parsed.usage.as_ref().map(|u| u.prompt_tokens).unwrap_or(0),
            output_tokens: parsed
                .usage
                .as_ref()
                .map(|u| u.completion_tokens)
                .unwrap_or(0),
        };

        Ok(ChatResponse {
            message,
            finish_reason,
            usage,
            model: parsed.model.unwrap_or_else(|| req.model.clone()),
        })
    }
}

fn build_request_body(req: &ChatRequest) -> Value {
    let messages: Vec<Value> = req
        .messages
        .iter()
        .map(|m| {
            let role = match m.role {
                Role::System => "system",
                Role::User => "user",
                Role::Assistant => "assistant",
                Role::Tool => "tool",
            };
            let mut obj = serde_json::Map::new();
            obj.insert("role".into(), Value::String(role.into()));
            if let Some(c) = &m.content {
                obj.insert("content".into(), Value::String(c.clone()));
            } else if matches!(m.role, Role::Assistant) && m.tool_calls.is_some() {
                obj.insert("content".into(), Value::Null);
            } else {
                obj.insert("content".into(), Value::String(String::new()));
            }
            if let Some(name) = &m.name {
                obj.insert("name".into(), Value::String(name.clone()));
            }
            if let Some(id) = &m.tool_call_id {
                obj.insert("tool_call_id".into(), Value::String(id.clone()));
            }
            if let Some(calls) = &m.tool_calls {
                obj.insert(
                    "tool_calls".into(),
                    Value::Array(
                        calls
                            .iter()
                            .map(|c| {
                                serde_json::json!({
                                    "id": c.id,
                                    "type": "function",
                                    "function": {
                                        "name": c.name,
                                        "arguments": c.arguments.to_string(),
                                    }
                                })
                            })
                            .collect(),
                    ),
                );
            }
            Value::Object(obj)
        })
        .collect();

    let mut body = serde_json::json!({
        "model": req.model,
        "messages": messages,
    });

    if let Some(t) = req.temperature {
        body["temperature"] = serde_json::json!(t);
    }

    if !req.tools.is_empty() {
        body["tools"] = Value::Array(
            req.tools
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    })
                })
                .collect(),
        );
        body["tool_choice"] = serde_json::json!("auto");
    }

    body
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    model: Option<String>,
    choices: Vec<OpenAiChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
    tool_calls: Option<Vec<OpenAiToolCall>>,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCall {
    id: String,
    function: OpenAiFunction,
}

#[derive(Debug, Deserialize)]
struct OpenAiFunction {
    name: String,
    arguments: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct OpenAiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorBody {
    error: OpenAiErrorInner,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorInner {
    message: String,
}
