use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::infra::oauth;
use crate::state::AppState;

use super::{CalendarEvent, EventDraft};

const BASE: &str = "https://www.googleapis.com/calendar/v3";
const PRIMARY: &str = "primary";

pub struct GoogleCalendar<'a> {
    state: &'a AppState,
}

impl<'a> GoogleCalendar<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub async fn list_events(
        &self,
        time_min: Option<&str>,
        time_max: Option<&str>,
        sync_token: Option<&str>,
        page_token: Option<&str>,
    ) -> AppResult<ListEventsResponse> {
        let mut url = format!("{BASE}/calendars/{PRIMARY}/events");
        let mut params: Vec<(&str, String)> = vec![
            ("singleEvents", "true".to_string()),
            ("maxResults", "250".to_string()),
            ("showDeleted", "true".to_string()),
        ];
        if let Some(token) = sync_token {
            params.push(("syncToken", token.to_string()));
        } else {
            if let Some(t) = time_min {
                params.push(("timeMin", t.to_string()));
            }
            if let Some(t) = time_max {
                params.push(("timeMax", t.to_string()));
            }
            params.push(("orderBy", "startTime".to_string()));
        }
        if let Some(t) = page_token {
            params.push(("pageToken", t.to_string()));
        }
        let qs: Vec<String> = params
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, urlencoding::encode(&v)))
            .collect();
        url.push('?');
        url.push_str(&qs.join("&"));

        let raw = self.send_authed(reqwest::Method::GET, &url, None).await?;
        let parsed: GoogleListResponse = serde_json::from_str(&raw)?;
        Ok(ListEventsResponse {
            events: parsed
                .items
                .into_iter()
                .filter_map(|i| google_item_to_event(i).ok())
                .collect(),
            next_page_token: parsed.next_page_token,
            next_sync_token: parsed.next_sync_token,
        })
    }

    pub async fn insert_event(&self, draft: &EventDraft) -> AppResult<CalendarEvent> {
        let url = format!("{BASE}/calendars/{PRIMARY}/events");
        let body = draft_to_body(draft);
        let raw = self
            .send_authed(reqwest::Method::POST, &url, Some(body))
            .await?;
        let item: GoogleEventItem = serde_json::from_str(&raw)?;
        google_item_to_event(item)
    }

    pub async fn delete_event(&self, google_event_id: &str) -> AppResult<()> {
        let url = format!("{BASE}/calendars/{PRIMARY}/events/{google_event_id}");
        self.send_authed(reqwest::Method::DELETE, &url, None).await?;
        Ok(())
    }

    async fn send_authed(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<Value>,
    ) -> AppResult<String> {
        let token = oauth::current_access_token(self.state).await?;
        let (status, text) = self
            .do_request(method.clone(), url, body.as_ref(), &token)
            .await?;
        if status.is_success() {
            return Ok(text);
        }

        if status == StatusCode::UNAUTHORIZED {
            tracing::info!("Google API 401, refreshing token");
            let fresh = oauth::refresh_access_token(self.state).await?;
            let (status2, text2) = self
                .do_request(method, url, body.as_ref(), &fresh)
                .await?;
            if status2.is_success() {
                return Ok(text2);
            }
            return Err(AppError::External(format!(
                "Google API {status2}: {}",
                truncate(&text2, 500)
            )));
        }

        if status == StatusCode::GONE {
            return Err(AppError::External("SYNC_TOKEN_EXPIRED".into()));
        }

        Err(AppError::External(format!(
            "Google API {status}: {}",
            truncate(&text, 500)
        )))
    }

    async fn do_request(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<&Value>,
        access: &str,
    ) -> AppResult<(StatusCode, String)> {
        let mut req = self.state.http.request(method, url).bearer_auth(access);
        if let Some(b) = body {
            req = req.json(b);
        }
        let resp = req.send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        Ok((status, text))
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

fn draft_to_body(draft: &EventDraft) -> Value {
    let (start, end) = if draft.all_day {
        (
            json!({ "date": draft.start_at }),
            json!({ "date": draft.end_at }),
        )
    } else {
        (
            json!({ "dateTime": draft.start_at }),
            json!({ "dateTime": draft.end_at }),
        )
    };
    let mut obj = serde_json::Map::new();
    obj.insert("summary".into(), Value::String(draft.summary.clone()));
    if let Some(d) = &draft.description {
        obj.insert("description".into(), Value::String(d.clone()));
    }
    if let Some(l) = &draft.location {
        obj.insert("location".into(), Value::String(l.clone()));
    }
    obj.insert("start".into(), start);
    obj.insert("end".into(), end);
    Value::Object(obj)
}

#[derive(Debug)]
pub struct ListEventsResponse {
    pub events: Vec<CalendarEvent>,
    pub next_page_token: Option<String>,
    pub next_sync_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleListResponse {
    #[serde(default)]
    items: Vec<GoogleEventItem>,
    #[serde(rename = "nextPageToken", default)]
    next_page_token: Option<String>,
    #[serde(rename = "nextSyncToken", default)]
    next_sync_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleEventItem {
    id: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    location: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    etag: Option<String>,
    #[serde(default)]
    updated: Option<String>,
    #[serde(default)]
    start: Option<GoogleEventTime>,
    #[serde(default)]
    end: Option<GoogleEventTime>,
}

#[derive(Debug, Deserialize)]
struct GoogleEventTime {
    #[serde(rename = "dateTime", default)]
    date_time: Option<String>,
    #[serde(default)]
    date: Option<String>,
}

fn google_item_to_event(item: GoogleEventItem) -> AppResult<CalendarEvent> {
    let id = item
        .id
        .ok_or_else(|| AppError::External("event id 없음".into()))?;
    let start = item
        .start
        .as_ref()
        .ok_or_else(|| AppError::External("event start 없음".into()))?;
    let end = item
        .end
        .as_ref()
        .ok_or_else(|| AppError::External("event end 없음".into()))?;
    let (start_at, all_day_s) = match (&start.date_time, &start.date) {
        (Some(dt), _) => (normalize_to_utc_z(dt), false),
        (None, Some(d)) => (d.clone(), true),
        _ => return Err(AppError::External("event start 형식 오류".into())),
    };
    let (end_at_raw, all_day_e) = match (&end.date_time, &end.date) {
        (Some(dt), _) => (normalize_to_utc_z(dt), false),
        (None, Some(d)) => (d.clone(), true),
        _ => return Err(AppError::External("event end 형식 오류".into())),
    };
    let all_day = all_day_s && all_day_e;
    // Google의 종일 이벤트는 end가 exclusive(종료 다음날). 우리는 inclusive로 통일하여 -1일.
    let end_at = if all_day {
        chrono::NaiveDate::parse_from_str(&end_at_raw, "%Y-%m-%d")
            .ok()
            .and_then(|d| d.pred_opt())
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or(end_at_raw)
    } else {
        end_at_raw
    };

    Ok(CalendarEvent {
        google_event_id: id,
        calendar_id: PRIMARY.into(),
        summary: item.summary.unwrap_or_default(),
        description: item.description,
        location: item.location,
        start_at,
        end_at,
        all_day,
        status: item.status.unwrap_or_else(|| "confirmed".into()),
        etag: item.etag,
        updated_at: item
            .updated
            .map(|u| normalize_to_utc_z(&u))
            .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()),
    })
}

fn normalize_to_utc_z(input: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(input)
        .map(|d| {
            d.with_timezone(&chrono::Utc)
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string()
        })
        .unwrap_or_else(|_| input.to_string())
}
