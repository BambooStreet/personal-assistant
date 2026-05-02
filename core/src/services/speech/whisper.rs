use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

const ENDPOINT: &str = "https://api.openai.com/v1/audio/transcriptions";

pub struct WhisperClient<'a> {
    state: &'a AppState,
}

impl<'a> WhisperClient<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub async fn transcribe(&self, audio: Vec<u8>, mime: &str) -> AppResult<TranscribeResult> {
        let key = self
            .state
            .secrets
            .get(SecretKey::OpenAiApiKey)?
            .ok_or_else(|| AppError::Unauthorized("OpenAI API key가 설정되지 않았습니다".into()))?;

        let filename = guess_filename(mime);
        let part = reqwest::multipart::Part::bytes(audio)
            .file_name(filename)
            .mime_str(mime)
            .map_err(|e| AppError::Internal(format!("multipart mime: {e}")))?;

        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", "whisper-1")
            .text("language", "ko")
            .text("response_format", "verbose_json");

        let resp = self
            .state
            .http
            .post(ENDPOINT)
            .bearer_auth(&key)
            .multipart(form)
            .send()
            .await?;

        let status = resp.status();
        let raw = resp.text().await?;

        if !status.is_success() {
            return Err(AppError::External(format!(
                "Whisper {status}: {}",
                truncate(&raw, 500)
            )));
        }

        let parsed: WhisperResponse = serde_json::from_str(&raw)?;
        Ok(TranscribeResult {
            text: parsed.text,
            duration_secs: parsed.duration.unwrap_or(0.0),
        })
    }
}

#[derive(Debug)]
pub struct TranscribeResult {
    pub text: String,
    pub duration_secs: f64,
}

#[derive(Debug, Deserialize)]
struct WhisperResponse {
    text: String,
    #[serde(default)]
    duration: Option<f64>,
}

fn guess_filename(mime: &str) -> &'static str {
    match mime {
        m if m.contains("webm") => "audio.webm",
        m if m.contains("ogg") => "audio.ogg",
        m if m.contains("mp4") || m.contains("m4a") => "audio.m4a",
        m if m.contains("wav") => "audio.wav",
        m if m.contains("mp3") || m.contains("mpeg") => "audio.mp3",
        _ => "audio.webm",
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}
