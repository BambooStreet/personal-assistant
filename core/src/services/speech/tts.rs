use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

const ENDPOINT: &str = "https://api.openai.com/v1/audio/speech";
pub const TTS_MODEL: &str = "gpt-4o-mini-tts";

// 캐릭터 톤 지시 — 귀엽고 친근한 작은 고양이 비서 느낌.
// gpt-4o-mini-tts의 instructions 파라미터에 전달.
const VOICE_INSTRUCTIONS: &str = "친근하고 발랄한 톤으로 말해주세요. \
작은 고양이 비서가 말하는 것처럼 따뜻하고 귀엽게, 살짝 들뜬 듯한 분위기로. \
문장 끝을 너무 빠르게 떨구지 말고 부드럽게, 한국어 자연스러운 억양 유지.";

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
            "model": TTS_MODEL,
            "input": text,
            "voice": voice,
            "instructions": VOICE_INSTRUCTIONS,
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
