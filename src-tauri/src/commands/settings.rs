use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretSlot {
    OpenaiApiKey,
    GoogleClientId,
    GoogleClientSecret,
}

impl SecretSlot {
    fn to_key(&self) -> SecretKey {
        match self {
            SecretSlot::OpenaiApiKey => SecretKey::OpenAiApiKey,
            SecretSlot::GoogleClientId => SecretKey::GoogleClientId,
            SecretSlot::GoogleClientSecret => SecretKey::GoogleClientSecret,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SecretStatus {
    pub slot: String,
    pub is_set: bool,
    pub preview: Option<String>,
}

#[tauri::command]
pub async fn secret_set(
    state: State<'_, AppState>,
    slot: SecretSlot,
    value: String,
) -> AppResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("empty secret".into()));
    }
    state.secrets.set(slot.to_key(), trimmed)
}

#[tauri::command]
pub async fn secret_delete(state: State<'_, AppState>, slot: SecretSlot) -> AppResult<()> {
    state.secrets.delete(slot.to_key())
}

#[tauri::command]
pub async fn secret_status(
    state: State<'_, AppState>,
    slot: SecretSlot,
) -> AppResult<SecretStatus> {
    let key = slot.to_key();
    let preview = state.secrets.masked_preview(key)?;
    Ok(SecretStatus {
        slot: key.account().to_string(),
        is_set: preview.is_some(),
        preview,
    })
}

#[tauri::command]
pub async fn secret_status_all(state: State<'_, AppState>) -> AppResult<Vec<SecretStatus>> {
    let slots = [
        SecretSlot::OpenaiApiKey,
        SecretSlot::GoogleClientId,
        SecretSlot::GoogleClientSecret,
    ];
    let mut out = Vec::with_capacity(slots.len());
    for s in slots {
        let key = s.to_key();
        let preview = state.secrets.masked_preview(key)?;
        out.push(SecretStatus {
            slot: key.account().to_string(),
            is_set: preview.is_some(),
            preview,
        });
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct AppHealth {
    pub db_ok: bool,
    pub version: &'static str,
}

#[tauri::command]
pub async fn app_health(state: State<'_, AppState>) -> AppResult<AppHealth> {
    let db_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();
    Ok(AppHealth {
        db_ok,
        version: env!("CARGO_PKG_VERSION"),
    })
}

const DAILY_CAP_KEY: &str = "daily_cost_cap_usd";
pub const DEFAULT_DAILY_CAP_USD: f64 = 1.0;

pub async fn read_daily_cap_usd(pool: &sqlx::SqlitePool) -> AppResult<f64> {
    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(DAILY_CAP_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(raw
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(DEFAULT_DAILY_CAP_USD))
}

#[tauri::command]
pub async fn daily_cap_get(state: State<'_, AppState>) -> AppResult<f64> {
    read_daily_cap_usd(&state.db).await
}

#[tauri::command]
pub async fn daily_cap_set(state: State<'_, AppState>, value: f64) -> AppResult<()> {
    if !(value.is_finite() && value >= 0.0) {
        return Err(AppError::InvalidInput("invalid cap".into()));
    }
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(DAILY_CAP_KEY)
    .bind(format!("{value}"))
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(())
}

const ALLOWED_SETTING_KEYS: &[&str] = &[
    "tts.voice",
    "tts.auto_play_briefing",
    "mic.device_id",
];

fn is_allowed_setting_key(key: &str) -> bool {
    ALLOWED_SETTING_KEYS.contains(&key)
}

#[tauri::command]
pub async fn settings_get(
    state: State<'_, AppState>,
    key: String,
) -> AppResult<Option<String>> {
    if !is_allowed_setting_key(&key) {
        return Err(AppError::InvalidInput(format!("허용되지 않은 키: {key}")));
    }
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    Ok(value)
}

#[tauri::command]
pub async fn settings_set(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<()> {
    if !is_allowed_setting_key(&key) {
        return Err(AppError::InvalidInput(format!("허용되지 않은 키: {key}")));
    }
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(&key)
    .bind(&value)
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(())
}
