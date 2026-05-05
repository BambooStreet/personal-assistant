use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::speech::cost::{tts_cost_usd, whisper_cost_usd};
use crate::services::speech::tts::TtsClient;
use crate::services::speech::whisper::WhisperClient;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct TranscribeArgs {
    pub audio_b64: String,
    #[serde(default)]
    pub mime: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TranscribeOutput {
    pub text: String,
    pub duration_secs: f64,
    pub cost_usd: f64,
}

pub async fn stt_transcribe(
    state: &AppState,
    args: TranscribeArgs,
) -> AppResult<TranscribeOutput> {
    let audio = B64
        .decode(args.audio_b64.as_bytes())
        .map_err(|e| AppError::InvalidInput(format!("base64 디코드 실패: {e}")))?;
    if audio.is_empty() {
        return Err(AppError::InvalidInput("빈 오디오".into()));
    }
    let mime = args.mime.unwrap_or_else(|| "audio/webm".to_string());

    let client = WhisperClient::new(state);
    let result = client.transcribe(audio, &mime).await?;
    let cost = whisper_cost_usd(result.duration_secs);

    let _ = sqlx::query(
        "INSERT INTO cost_ledger (ts, provider, kind, model, audio_seconds, cost_usd) \
         VALUES (?, 'openai', 'stt', 'whisper-1', ?, ?)",
    )
    .bind(Utc::now().to_rfc3339())
    .bind(result.duration_secs)
    .bind(cost)
    .execute(&state.db)
    .await;

    Ok(TranscribeOutput {
        text: result.text,
        duration_secs: result.duration_secs,
        cost_usd: cost,
    })
}

#[derive(Debug, Deserialize)]
pub struct SpeakArgs {
    pub text: String,
    #[serde(default)]
    pub voice: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SpeakOutput {
    pub audio_b64: String,
    pub mime: &'static str,
    pub chars: usize,
    pub cost_usd: f64,
}

pub async fn tts_speak(state: &AppState, args: SpeakArgs) -> AppResult<SpeakOutput> {
    let text = args.text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::InvalidInput("빈 텍스트".into()));
    }
    let voice = args.voice.unwrap_or_else(|| "alloy".to_string());

    let client = TtsClient::new(state);
    let bytes = client.speak(&text, &voice).await?;

    let chars = text.chars().count();
    let cost = tts_cost_usd(chars);

    let _ = sqlx::query(
        "INSERT INTO cost_ledger (ts, provider, kind, model, chars, cost_usd) \
         VALUES (?, 'openai', 'tts', 'gpt-4o-mini-tts', ?, ?)",
    )
    .bind(Utc::now().to_rfc3339())
    .bind(chars as i64)
    .bind(cost)
    .execute(&state.db)
    .await;

    Ok(SpeakOutput {
        audio_b64: B64.encode(&bytes),
        mime: "audio/mpeg",
        chars,
        cost_usd: cost,
    })
}
