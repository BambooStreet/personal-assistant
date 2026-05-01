use tauri::State;

use crate::error::AppResult;
use crate::services::briefing::{self, Briefing};
use crate::state::AppState;

#[tauri::command]
pub async fn briefing_today(state: State<'_, AppState>) -> AppResult<Option<Briefing>> {
    briefing::get_today(&state).await
}

#[tauri::command]
pub async fn briefing_run(state: State<'_, AppState>, force: Option<bool>) -> AppResult<Briefing> {
    briefing::run_for_today(&state, force.unwrap_or(false)).await
}
