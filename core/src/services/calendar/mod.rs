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
