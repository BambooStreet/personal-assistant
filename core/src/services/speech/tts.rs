use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

const ENDPOINT: &str = "https://api.openai.com/v1/audio/speech";
pub const TTS_MODEL: &str = "gpt-4o-mini-tts";

// 캐릭터 톤 지시 — 어린 소녀 + 새끼 고양이 비서 느낌.
// gpt-4o-mini-tts의 instructions 파라미터에 전달.
const VOICE_INSTRUCTIONS: &str = "어린 소녀처럼 밝고 귀여운 톤으로 또박또박 말해주세요. \
작은 새끼 고양이 비서가 말하듯이 살짝 높은 음색에 발랄하고 호기심 많은 분위기로. \
단어 끝을 부드럽게 살짝 올려서 사랑스럽고 다정한 느낌을 주되, 너무 빠르거나 단조롭지 않게. \
한국어 자연스러운 억양은 유지하면서 따뜻함이 묻어나도록 해주세요.";

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
