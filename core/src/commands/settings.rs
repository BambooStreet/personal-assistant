use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

// ===== App health =====

#[derive(Debug, Serialize)]
pub struct AppHealth {
    pub db_ok: bool,
    pub version: &'static str,
}

pub async fn app_health(state: &AppState) -> AppResult<AppHealth> {
    let db_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();
    Ok(AppHealth {
        db_ok,
        version: env!("CARGO_PKG_VERSION"),
    })
}

// ===== Secret slot =====

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum SecretSlot {
    OpenaiApiKey,
    GoogleClientId,
    GoogleClientSecret,
}

impl SecretSlot {
    fn to_key(self) -> SecretKey {
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

#[derive(Debug, Deserialize)]
pub struct SecretSetArgs {
    pub slot: SecretSlot,
    pub value: String,
}

pub async fn secret_set(state: &AppState, args: SecretSetArgs) -> AppResult<()> {
    let trimmed = args.value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("empty secret".into()));
    }
    state.secrets.set(args.slot.to_key(), trimmed)
}

#[derive(Debug, Deserialize)]
pub struct SecretSlotArgs {
    pub slot: SecretSlot,
}

pub async fn secret_delete(state: &AppState, args: SecretSlotArgs) -> AppResult<()> {
    state.secrets.delete(args.slot.to_key())
}

pub async fn secret_status(state: &AppState, args: SecretSlotArgs) -> AppResult<SecretStatus> {
    let key = args.slot.to_key();
    let preview = state.secrets.masked_preview(key)?;
    Ok(SecretStatus {
        slot: key.account().to_string(),
        is_set: preview.is_some(),
        preview,
    })
}

pub async fn secret_status_all(state: &AppState) -> AppResult<Vec<SecretStatus>> {
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

// ===== Daily cap =====

const DAILY_CAP_KEY: &str = "daily_cost_cap_usd";
pub const DEFAULT_DAILY_CAP_USD: f64 = 1.0;

pub async fn read_daily_cap_usd(pool: &sqlx::SqlitePool, user_id: i64) -> AppResult<f64> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind(DAILY_CAP_KEY)
            .fetch_optional(pool)
            .await?;
    Ok(raw
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(DEFAULT_DAILY_CAP_USD))
}

pub async fn daily_cap_get(state: &AppState, user_id: i64) -> AppResult<f64> {
    read_daily_cap_usd(&state.db, user_id).await
}

#[derive(Debug, Deserialize)]
pub struct DailyCapSetArgs {
    pub value: f64,
}

pub async fn daily_cap_set(state: &AppState, user_id: i64, args: DailyCapSetArgs) -> AppResult<()> {
    if !(args.value.is_finite() && args.value >= 0.0) {
        return Err(AppError::InvalidInput("invalid cap".into()));
    }
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) \
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(user_id)
    .bind(DAILY_CAP_KEY)
    .bind(format!("{}", args.value))
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(())
}

// ===== Generic settings (allowlist) =====

const ALLOWED_SETTING_KEYS: &[&str] = &[
    "tts.voice",
    "tts.auto_play_briefing",
    "mic.device_id",
    "mic.threshold_rms",
    "mic.silence_ms",
    "mic.initial_wait_ms",
    "mic.followup_initial_wait_ms",
    "mic.followup_max_duration_ms",
    "onboarding.completed",
    "user.name",
    "voice.enabled",
    "voice.followup_enabled",
    "wake.threshold",
    "wake.display_label",
    "wake.measurement_mode",
    "notifications.enabled",
    "notifications.tts_enabled",
    "notifications.before_1h",
    "notifications.before_15m",
    "notifications.dnd_enabled",
    "notifications.dnd_start",
    "notifications.dnd_end",
    // 생활 프로필 — 일과 자동 배치(빈 슬롯 계산)의 입력. 시각은 "HH:MM",
    // blocks는 JSON 배열 문자열 [{label, days:[0..6], start, end}].
    "lifestyle.wake_weekday",
    "lifestyle.sleep_weekday",
    "lifestyle.wake_weekend",
    "lifestyle.sleep_weekend",
    "lifestyle.blocks",
];

fn is_allowed_setting_key(key: &str) -> bool {
    ALLOWED_SETTING_KEYS.contains(&key)
}

#[derive(Debug, Deserialize)]
pub struct SettingsGetArgs {
    pub key: String,
}

pub async fn settings_get(
    state: &AppState,
    user_id: i64,
    args: SettingsGetArgs,
) -> AppResult<Option<String>> {
    if !is_allowed_setting_key(&args.key) {
        return Err(AppError::InvalidInput(format!("허용되지 않은 키: {}", args.key)));
    }
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind(&args.key)
            .fetch_optional(&state.db)
            .await?
            .flatten();
    Ok(value)
}

#[derive(Debug, Deserialize)]
pub struct SettingsSetArgs {
    pub key: String,
    pub value: String,
}

pub async fn settings_set(state: &AppState, user_id: i64, args: SettingsSetArgs) -> AppResult<()> {
    if !is_allowed_setting_key(&args.key) {
        return Err(AppError::InvalidInput(format!("허용되지 않은 키: {}", args.key)));
    }
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) \
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(user_id)
    .bind(&args.key)
    .bind(&args.value)
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(())
}
