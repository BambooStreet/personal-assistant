use serde::Serialize;

use crate::error::AppResult;
use crate::infra::oauth;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct GoogleStatus {
    pub connected: bool,
}

pub async fn oauth_google_start(state: &AppState) -> AppResult<GoogleStatus> {
    oauth::start_google_oauth(state).await?;
    Ok(GoogleStatus { connected: true })
}

pub async fn oauth_google_status(state: &AppState) -> AppResult<GoogleStatus> {
    let connected = oauth::is_connected(state).await?;
    Ok(GoogleStatus { connected })
}

pub async fn oauth_google_disconnect(state: &AppState) -> AppResult<()> {
    oauth::disconnect(state).await
}
