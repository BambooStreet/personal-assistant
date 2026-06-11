pub mod google;
pub mod sync;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub google_event_id: String,
    pub calendar_id: String,
    pub summary: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    pub start_at: String,
    pub end_at: String,
    #[serde(default)]
    pub all_day: bool,
    pub status: String,
    #[serde(default)]
    pub etag: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventDraft {
    pub summary: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    pub start_at: String,
    pub end_at: String,
    #[serde(default)]
    pub all_day: bool,
}

/// 부분 수정용 — 준 필드만 PATCH로 반영(None은 건드리지 않음).
/// start_at/end_at을 바꿀 때 종일 여부가 달라지면 all_day도 함께 줘야 한다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EventPatch {
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub all_day: Option<bool>,
}
