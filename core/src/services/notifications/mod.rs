use std::sync::Arc;

use chrono::{Duration, Local, NaiveTime, Utc};
use serde_json::json;
use sqlx::Row;

use crate::error::AppResult;
use crate::state::AppState;

const INITIAL_DELAY_SECS: u64 = 10;
const TICK_INTERVAL_SECS: u64 = 60;

const BEFORE_1H_MINUTES: i64 = 60;
const BEFORE_15M_MINUTES: i64 = 15;

struct Candidate {
    event_id: i64,
    summary: String,
    start_at: String,
}

pub async fn run_scheduler_loop(state: Arc<AppState>) {
    tokio::time::sleep(std::time::Duration::from_secs(INITIAL_DELAY_SECS)).await;
    loop {
        if let Err(e) = tick(&state).await {
            tracing::warn!(error = %e, "notifications tick failed");
        }
        tokio::time::sleep(std::time::Duration::from_secs(TICK_INTERVAL_SECS)).await;
    }
}

async fn tick(state: &AppState) -> AppResult<()> {
    if !get_bool_setting(state, "notifications.enabled", true).await? {
        return Ok(());
    }

    if get_bool_setting(state, "notifications.dnd_enabled", false).await? {
        let start = get_string_setting(state, "notifications.dnd_start", "22:00").await?;
        let end = get_string_setting(state, "notifications.dnd_end", "08:00").await?;
        if is_in_dnd(Local::now().time(), &start, &end) {
            return Ok(());
        }
    }

    let tts_enabled = get_bool_setting(state, "notifications.tts_enabled", false).await?;

    if get_bool_setting(state, "notifications.before_1h", true).await? {
        for c in select_pending(state, "1h", BEFORE_1H_MINUTES).await? {
            fire(state, &c, "1h", tts_enabled).await?;
        }
    }
    if get_bool_setting(state, "notifications.before_15m", true).await? {
        for c in select_pending(state, "15m", BEFORE_15M_MINUTES).await? {
            fire(state, &c, "15m", tts_enabled).await?;
        }
    }
    Ok(())
}

async fn fire(state: &AppState, c: &Candidate, kind: &str, tts_enabled: bool) -> AppResult<()> {
    state.emit(
        "notification.fired",
        json!({
            "event_id": c.event_id,
            "summary": c.summary,
            "start_at": c.start_at,
            "kind": kind,
            "tts_enabled": tts_enabled,
        }),
    );
    mark_sent(state, c.event_id, kind).await?;
    tracing::info!(event_id = c.event_id, kind, "notification fired");
    Ok(())
}

async fn select_pending(
    state: &AppState,
    kind: &str,
    minutes_before: i64,
) -> AppResult<Vec<Candidate>> {
    let now = Utc::now();
    let now_rfc = now.to_rfc3339();
    let threshold = (now + Duration::minutes(minutes_before)).to_rfc3339();

    let rows = sqlx::query(
        "SELECT e.id, e.summary, e.start_at \
         FROM events e \
         LEFT JOIN notifications_sent n ON n.event_id = e.id AND n.kind = ? \
         WHERE e.status != 'cancelled' \
           AND e.all_day = 0 \
           AND e.start_at > ? \
           AND e.start_at <= ? \
           AND n.event_id IS NULL \
         ORDER BY e.start_at ASC",
    )
    .bind(kind)
    .bind(&now_rfc)
    .bind(&threshold)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Candidate {
            event_id: r.get("id"),
            summary: r.get("summary"),
            start_at: r.get("start_at"),
        })
        .collect())
}

async fn mark_sent(state: &AppState, event_id: i64, kind: &str) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO notifications_sent (event_id, kind, sent_at) VALUES (?, ?, ?)",
    )
    .bind(event_id)
    .bind(kind)
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn get_bool_setting(state: &AppState, key: &str, default: bool) -> AppResult<bool> {
    let v: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    Ok(match v.as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => default,
    })
}

async fn get_string_setting(state: &AppState, key: &str, default: &str) -> AppResult<String> {
    let v: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    Ok(v.unwrap_or_else(|| default.to_string()))
}

// DND 윈도우 판정 — start>end면 자정 가로지름 (e.g. 22:00~08:00).
// start==end면 윈도우 0폭으로 보고 DND 아님.
fn is_in_dnd(now: NaiveTime, start_str: &str, end_str: &str) -> bool {
    let Ok(start) = NaiveTime::parse_from_str(start_str, "%H:%M") else {
        return false;
    };
    let Ok(end) = NaiveTime::parse_from_str(end_str, "%H:%M") else {
        return false;
    };
    if start == end {
        return false;
    }
    if start < end {
        now >= start && now < end
    } else {
        now >= start || now < end
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dnd_same_day_window() {
        // 13:00 ~ 14:00
        let start = "13:00";
        let end = "14:00";
        assert!(!is_in_dnd(NaiveTime::from_hms_opt(12, 59, 0).unwrap(), start, end));
        assert!(is_in_dnd(NaiveTime::from_hms_opt(13, 0, 0).unwrap(), start, end));
        assert!(is_in_dnd(NaiveTime::from_hms_opt(13, 30, 0).unwrap(), start, end));
        assert!(!is_in_dnd(NaiveTime::from_hms_opt(14, 0, 0).unwrap(), start, end));
    }

    #[test]
    fn dnd_overnight_window() {
        // 22:00 ~ 08:00
        let start = "22:00";
        let end = "08:00";
        assert!(!is_in_dnd(NaiveTime::from_hms_opt(21, 59, 0).unwrap(), start, end));
        assert!(is_in_dnd(NaiveTime::from_hms_opt(22, 0, 0).unwrap(), start, end));
        assert!(is_in_dnd(NaiveTime::from_hms_opt(23, 30, 0).unwrap(), start, end));
        assert!(is_in_dnd(NaiveTime::from_hms_opt(2, 0, 0).unwrap(), start, end));
        assert!(is_in_dnd(NaiveTime::from_hms_opt(7, 59, 0).unwrap(), start, end));
        assert!(!is_in_dnd(NaiveTime::from_hms_opt(8, 0, 0).unwrap(), start, end));
        assert!(!is_in_dnd(NaiveTime::from_hms_opt(12, 0, 0).unwrap(), start, end));
    }

    #[test]
    fn dnd_zero_width_disabled() {
        assert!(!is_in_dnd(NaiveTime::from_hms_opt(12, 0, 0).unwrap(), "12:00", "12:00"));
    }

    #[test]
    fn dnd_bad_input_returns_false() {
        assert!(!is_in_dnd(NaiveTime::from_hms_opt(12, 0, 0).unwrap(), "bad", "08:00"));
    }
}
