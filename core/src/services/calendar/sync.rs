use chrono::{Duration, Utc};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::google::GoogleCalendar;
use super::CalendarEvent;

const PROVIDER: &str = "google_calendar";
const FULL_SYNC_PAST_DAYS: i64 = 7;
const FULL_SYNC_FUTURE_DAYS: i64 = 60;

#[derive(Debug, Serialize, Default)]
pub struct SyncReport {
    pub fetched: usize,
    pub upserts: usize,
    pub deletions: usize,
    pub full_sync: bool,
}

pub async fn run_sync(state: &AppState, user_id: i64) -> AppResult<SyncReport> {
    let mut report = SyncReport::default();
    let client = GoogleCalendar::new(state);

    let stored_token: Option<String> = sqlx::query_scalar(
        "SELECT sync_token FROM sync_state WHERE user_id = ? AND provider = ?",
    )
    .bind(user_id)
    .bind(PROVIDER)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    let next_sync: Option<String> = if let Some(token) = stored_token {
        match incremental(&client, &token, state, user_id, &mut report).await {
            Ok(t) => t,
            Err(AppError::External(msg)) if msg == "SYNC_TOKEN_EXPIRED" => {
                tracing::warn!("syncToken 만료, full sync로 폴백");
                full_sync(&client, state, user_id, &mut report).await?
            }
            Err(e) => return Err(e),
        }
    } else {
        full_sync(&client, state, user_id, &mut report).await?
    };

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO sync_state (user_id, provider, sync_token, last_full_sync_at, last_incremental_at) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(user_id, provider) DO UPDATE SET sync_token = excluded.sync_token, \
         last_incremental_at = excluded.last_incremental_at, \
         last_full_sync_at = COALESCE(excluded.last_full_sync_at, sync_state.last_full_sync_at)",
    )
    .bind(user_id)
    .bind(PROVIDER)
    .bind(&next_sync)
    .bind(if report.full_sync { Some(now.clone()) } else { None })
    .bind(&now)
    .execute(&state.db)
    .await?;

    Ok(report)
}

async fn full_sync(
    client: &GoogleCalendar<'_>,
    state: &AppState,
    user_id: i64,
    report: &mut SyncReport,
) -> AppResult<Option<String>> {
    report.full_sync = true;
    let time_min = (Utc::now() - Duration::days(FULL_SYNC_PAST_DAYS)).to_rfc3339();
    let time_max = (Utc::now() + Duration::days(FULL_SYNC_FUTURE_DAYS)).to_rfc3339();

    let mut next_page: Option<String> = None;
    let mut next_sync: Option<String> = None;
    loop {
        let resp = client
            .list_events(
                Some(&time_min),
                Some(&time_max),
                None,
                next_page.as_deref(),
            )
            .await?;
        report.fetched += resp.events.len();
        apply_events(state, user_id, &resp.events, report).await?;
        next_sync = resp.next_sync_token.or(next_sync);
        match resp.next_page_token {
            Some(t) => next_page = Some(t),
            None => break,
        }
    }
    Ok(next_sync)
}

async fn incremental(
    client: &GoogleCalendar<'_>,
    sync_token: &str,
    state: &AppState,
    user_id: i64,
    report: &mut SyncReport,
) -> AppResult<Option<String>> {
    let mut next_page: Option<String> = None;
    let mut next_sync: Option<String> = Some(sync_token.to_string());
    let mut current_token = Some(sync_token.to_string());
    loop {
        let resp = client
            .list_events(None, None, current_token.as_deref(), next_page.as_deref())
            .await?;
        report.fetched += resp.events.len();
        apply_events(state, user_id, &resp.events, report).await?;
        if let Some(t) = resp.next_sync_token {
            next_sync = Some(t);
        }
        match resp.next_page_token {
            Some(t) => {
                next_page = Some(t);
                current_token = None;
            }
            None => break,
        }
    }
    Ok(next_sync)
}

async fn apply_events(
    state: &AppState,
    user_id: i64,
    events: &[CalendarEvent],
    report: &mut SyncReport,
) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    for ev in events {
        if ev.status == "cancelled" {
            let res = sqlx::query("DELETE FROM events WHERE user_id = ? AND google_event_id = ?")
                .bind(user_id)
                .bind(&ev.google_event_id)
                .execute(&state.db)
                .await?;
            if res.rows_affected() > 0 {
                report.deletions += 1;
            }
            continue;
        }

        sqlx::query(
            "INSERT INTO events (user_id, google_event_id, calendar_id, summary, description, location, \
             start_at, end_at, all_day, status, etag, updated_at, synced_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(user_id, google_event_id) DO UPDATE SET \
             summary = excluded.summary, description = excluded.description, \
             location = excluded.location, start_at = excluded.start_at, \
             end_at = excluded.end_at, all_day = excluded.all_day, \
             status = excluded.status, etag = excluded.etag, \
             updated_at = excluded.updated_at, synced_at = excluded.synced_at",
        )
        .bind(user_id)
        .bind(&ev.google_event_id)
        .bind(&ev.calendar_id)
        .bind(&ev.summary)
        .bind(&ev.description)
        .bind(&ev.location)
        .bind(&ev.start_at)
        .bind(&ev.end_at)
        .bind(if ev.all_day { 1 } else { 0 })
        .bind(&ev.status)
        .bind(&ev.etag)
        .bind(&ev.updated_at)
        .bind(&now)
        .execute(&state.db)
        .await?;
        report.upserts += 1;
    }
    Ok(())
}
