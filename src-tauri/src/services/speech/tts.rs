use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

const ENDPOINT: &str = "https://api.openai.com/v1/audio/speech";

pub struct TtsClient<'a> {
    state: &'a AppState,
}

impl<'a> TtsClient<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub async fn speak(&self, text: &str, voice: &str) -> AppResult<Vec<u8>> {
        let key = self
            .state
            .secrets
            .get(SecretKey::OpenAiApiKey)?
            .ok_or_else(|| AppError::Unauthorized("OpenAI API key가 설정되지 않았습니다".into()))?;

        let body = json!({
            "model": "tts-1",
            "input": text,
            "voice": voice,
            "response_format": "mp3",
        });

        let resp = self
            .state
            .http
            .post(ENDPOINT)
            .bearer_auth(&key)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let raw = resp.text().await.unwrap_or_default();
            return Err(AppError::External(format!(
                "TTS {status}: {}",
                raw.chars().take(500).collect::<String>()
            )));
        }

        let bytes = resp.bytes().await?;
        Ok(bytes.to_vec())
    }
}
