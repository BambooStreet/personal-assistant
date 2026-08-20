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
// 출발 알림(leave): 다음 N시간 이내 시작 이벤트만 이동시간을 계산한다(비용/부하 가드).
const LEAVE_WINDOW_HOURS: i64 = 3;

struct Candidate {
    event_id: i64,
    summary: String,
    start_at: String,
}

pub async fn run_scheduler_loop(state: Arc<AppState>) {
    tokio::time::sleep(std::time::Duration::from_secs(INITIAL_DELAY_SECS)).await;
    loop {
        match list_user_ids(&state).await {
            Ok(uids) => {
                for uid in uids {
                    if let Err(e) = tick(&state, uid).await {
                        tracing::warn!(user_id = uid, error = %e, "notifications tick failed");
                    }
                    // 루틴 알림은 tick() 안에 넣을 수 없다 — tick()은 DND면 함수 전체를 early
                    // return 하는데, 루틴은 사용자가 직접 정한 시각이라 DND를 통과해야 한다.
                    // 한쪽 실패가 다른 쪽을 죽이지 않도록 에러 처리도 분리.
                    if let Err(e) = crate::services::goals::routines_tick(&state, uid).await {
                        tracing::warn!(user_id = uid, error = %e, "routines tick failed");
                    }
                }
            }
            Err(e) => tracing::warn!(error = %e, "notifications: list users failed"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(TICK_INTERVAL_SECS)).await;
    }
}

/// 멀티테넌트: 스케줄러는 모든 유저를 순회하며 유저별로 알림을 판정한다.
async fn list_user_ids(state: &AppState) -> AppResult<Vec<i64>> {
    let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM users")
        .fetch_all(&state.db)
        .await?;
    Ok(ids)
}

async fn tick(state: &AppState, user_id: i64) -> AppResult<()> {
    if !get_bool_setting(state, user_id, "notifications.enabled", true).await? {
        return Ok(());
    }

    if get_bool_setting(state, user_id, "notifications.dnd_enabled", false).await? {
        let start = get_string_setting(state, user_id, "notifications.dnd_start", "22:00").await?;
        let end = get_string_setting(state, user_id, "notifications.dnd_end", "08:00").await?;
        if is_in_dnd(Local::now().time(), &start, &end) {
            return Ok(());
        }
    }

    let tts_enabled = get_bool_setting(state, user_id, "notifications.tts_enabled", false).await?;

    if get_bool_setting(state, user_id, "notifications.before_1h", true).await? {
        for c in select_pending(state, user_id, "1h", BEFORE_1H_MINUTES).await? {
            fire(state, user_id, &c, "1h", tts_enabled).await?;
        }
    }
    if get_bool_setting(state, user_id, "notifications.before_15m", true).await? {
        for c in select_pending(state, user_id, "15m", BEFORE_15M_MINUTES).await? {
            fire(state, user_id, &c, "15m", tts_enabled).await?;
        }
    }
    // 출발 알림(leave): 이동시간 계산 후 출발 시각이 도래한 일정에 한해 발화.
    if get_bool_setting(state, user_id, "notifications.leave_enabled", false).await? {
        for leg in select_pending_leave(state, user_id).await? {
            fire_leave(state, user_id, &leg, tts_enabled).await?;
        }
    }
    Ok(())
}

async fn fire(
    state: &AppState,
    user_id: i64,
    c: &Candidate,
    kind: &str,
    tts_enabled: bool,
) -> AppResult<()> {
    state.emit(
        "notification.fired",
        json!({
            "user_id": user_id,
            "event_id": c.event_id,
            "summary": c.summary,
            "start_at": c.start_at,
            "kind": kind,
            "tts_enabled": tts_enabled,
        }),
    );
    mark_sent(state, c.event_id, kind).await?;
    tracing::info!(user_id, event_id = c.event_id, kind, "notification fired");
    Ok(())
}

/// 출발 알림 후보: 다음 N시간 이내 시작 일정의 이동 구간을 계산하고,
/// 아직 보내지 않았으며 출발 시각(depart_by)이 도래한 것만 반환.
/// leg 계산은 travel 서비스가 캐시 우선으로 수행(외부 호출 최소).
async fn select_pending_leave(
    state: &AppState,
    user_id: i64,
) -> AppResult<Vec<crate::services::travel::Leg>> {
    let now = Utc::now();
    let legs = crate::services::travel::legs_in_window(state, user_id, LEAVE_WINDOW_HOURS).await?;
    let mut out = Vec::new();
    for leg in legs {
        // 이미 발송됐으면 skip(디듑).
        if is_already_sent(state, leg.event_id, "leave").await? {
            continue;
        }
        let Ok(depart) = chrono::DateTime::parse_from_rfc3339(&leg.depart_by) else {
            continue;
        };
        let Ok(start) = chrono::DateTime::parse_from_rfc3339(&leg.start_at) else {
            continue;
        };
        // 출발 시각 도래(과거 포함) && 아직 시작 전.
        if now >= depart.with_timezone(&Utc) && now < start.with_timezone(&Utc) {
            out.push(leg);
        }
    }
    Ok(out)
}

async fn is_already_sent(state: &AppState, event_id: i64, kind: &str) -> AppResult<bool> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM notifications_sent WHERE event_id = ? AND kind = ? LIMIT 1",
    )
    .bind(event_id)
    .bind(kind)
    .fetch_optional(&state.db)
    .await?;
    Ok(found.is_some())
}

async fn fire_leave(
    state: &AppState,
    user_id: i64,
    leg: &crate::services::travel::Leg,
    tts_enabled: bool,
) -> AppResult<()> {
    state.emit(
        "notification.fired",
        json!({
            "user_id": user_id,
            "event_id": leg.event_id,
            "summary": leg.summary,
            "start_at": leg.start_at,
            "kind": "leave",
            "tts_enabled": tts_enabled,
            "leave_at": leg.depart_by,
            "duration_min": leg.duration_min,
            "transfers": leg.transfers,
            "mode": leg.mode,
            "from": leg.from,
            "to": leg.to,
        }),
    );
    mark_sent(state, leg.event_id, "leave").await?;
    tracing::info!(user_id, event_id = leg.event_id, "leave notification fired");
    Ok(())
}

async fn select_pending(
    state: &AppState,
    user_id: i64,
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
         WHERE e.user_id = ? \
           AND e.status != 'cancelled' \
           AND e.all_day = 0 \
           AND e.start_at > ? \
           AND e.start_at <= ? \
           AND n.event_id IS NULL \
         ORDER BY e.start_at ASC",
    )
    .bind(kind)
    .bind(user_id)
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

async fn get_bool_setting(
    state: &AppState,
    user_id: i64,
    key: &str,
    default: bool,
) -> AppResult<bool> {
    let v: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
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

async fn get_string_setting(
    state: &AppState,
    user_id: i64,
    key: &str,
    default: &str,
) -> AppResult<String> {
    let v: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
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
