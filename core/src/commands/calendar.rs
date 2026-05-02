use chrono::{Duration, Local, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::services::calendar::google::GoogleCalendar;
use crate::services::calendar::sync::{run_sync, SyncReport};
use crate::services::calendar::{CalendarEvent, EventDraft};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct StoredEvent {
    pub id: i64,
    pub google_event_id: Option<String>,
    pub summary: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_at: String,
    pub end_at: String,
    pub all_day: bool,
    pub status: String,
}

fn row_to_stored(row: &sqlx::sqlite::SqliteRow) -> StoredEvent {
    StoredEvent {
        id: row.get("id"),
        google_event_id: row.get("google_event_id"),
        summary: row.get("summary"),
        description: row.get("description"),
        location: row.get("location"),
        start_at: row.get("start_at"),
        end_at: row.get("end_at"),
        all_day: row.get::<i64, _>("all_day") != 0,
        status: row.get("status"),
    }
}

pub async fn calendar_today_events(state: &AppState) -> AppResult<Vec<StoredEvent>> {
    let now = Local::now();
    let day_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(now.timezone())
        .unwrap()
        .to_utc()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    let day_end = now
        .date_naive()
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_local_timezone(now.timezone())
        .unwrap()
        .to_utc()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    let rows = sqlx::query(
        "SELECT id, google_event_id, summary, description, location, start_at, end_at, all_day, status \
         FROM events \
         WHERE status != 'cancelled' AND end_at > ? AND start_at <= ? \
         ORDER BY start_at ASC",
    )
    .bind(&day_start)
    .bind(&day_end)
    .fetch_all(&state.db)
    .await?;

    Ok(rows.iter().map(row_to_stored).collect())
}

#[derive(Debug, Deserialize)]
pub struct UpcomingArgs {
    #[serde(default)]
    pub days: Option<i64>,
}

pub async fn calendar_upcoming_events(
    state: &AppState,
    args: UpcomingArgs,
) -> AppResult<Vec<StoredEvent>> {
    let d = args.days.unwrap_or(7).clamp(1, 60);
    let now = Utc::now().to_rfc3339();
    let until = (Utc::now() + Duration::days(d)).to_rfc3339();
    let rows = sqlx::query(
        "SELECT id, google_event_id, summary, description, location, start_at, end_at, all_day, status \
         FROM events \
         WHERE status != 'cancelled' AND end_at >= ? AND start_at <= ? \
         ORDER BY start_at ASC LIMIT 50",
    )
    .bind(&now)
    .bind(&until)
    .fetch_all(&state.db)
    .await?;

    Ok(rows.iter().map(row_to_stored).collect())
}

pub async fn calendar_sync_now(state: &AppState) -> AppResult<SyncReport> {
    run_sync(state).await
}

#[derive(Debug, Deserialize)]
pub struct CreateEventArgs {
    pub draft: EventDraft,
}

pub async fn calendar_create_event(
    state: &AppState,
    args: CreateEventArgs,
) -> AppResult<StoredEvent> {
    if args.draft.summary.trim().is_empty() {
        return Err(AppError::InvalidInput("summary 비어있음".into()));
    }
    let client = GoogleCalendar::new(state);
    let created: CalendarEvent = client.insert_event(&args.draft).await?;
    upsert_one(&state.db, &created).await?;
    fetch_by_google_id(&state.db, &created.google_event_id).await
}

#[derive(Debug, Deserialize)]
pub struct DeleteEventArgs {
    pub google_event_id: String,
}

pub async fn calendar_delete_event(state: &AppState, args: DeleteEventArgs) -> AppResult<()> {
    let client = GoogleCalendar::new(state);
    client.delete_event(&args.google_event_id).await?;
    sqlx::query("DELETE FROM events WHERE google_event_id = ?")
        .bind(&args.google_event_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

async fn upsert_one(pool: &sqlx::SqlitePool, ev: &CalendarEvent) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO events (google_event_id, calendar_id, summary, description, location, \
         start_at, end_at, all_day, status, etag, updated_at, synced_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(google_event_id) DO UPDATE SET \
         summary = excluded.summary, description = excluded.description, \
         location = excluded.location, start_at = excluded.start_at, \
         end_at = excluded.end_at, all_day = excluded.all_day, \
         status = excluded.status, etag = excluded.etag, \
         updated_at = excluded.updated_at, synced_at = excluded.synced_at",
    )
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
    .execute(pool)
    .await?;
    Ok(())
}

async fn fetch_by_google_id(pool: &sqlx::SqlitePool, google_id: &str) -> AppResult<StoredEvent> {
    let row = sqlx::query(
        "SELECT id, google_event_id, summary, description, location, start_at, end_at, all_day, status \
         FROM events WHERE google_event_id = ?",
    )
    .bind(google_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("event {google_id}")))?;
    Ok(row_to_stored(&row))
}
