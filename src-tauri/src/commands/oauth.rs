use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::infra::oauth;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct GoogleStatus {
    pub connected: bool,
}

#[tauri::command]
pub async fn oauth_google_start(
    state: State<'_, AppState>,
    app: AppHandle,
) -> AppResult<GoogleStatus> {
    oauth::start_google_oauth(&state, &app).await?;
    Ok(GoogleStatus { connected: true })
}

#[tauri::command]
pub async fn oauth_google_status(state: State<'_, AppState>) -> AppResult<GoogleStatus> {
    let connected = oauth::is_connected(&state).await?;
    Ok(GoogleStatus { connected })
}

#[tauri::command]
pub async fn oauth_google_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    oauth::disconnect(&state).await
}
