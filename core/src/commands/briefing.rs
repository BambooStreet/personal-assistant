use serde::Deserialize;

use crate::error::AppResult;
use crate::services::briefing::{self, Briefing};
use crate::state::AppState;

pub async fn briefing_today(state: &AppState, user_id: i64) -> AppResult<Option<Briefing>> {
    briefing::get_today(state, user_id).await
}

#[derive(Debug, Deserialize)]
pub struct BriefingRunArgs {
    #[serde(default)]
    pub force: Option<bool>,
}

pub async fn briefing_run(
    state: &AppState,
    user_id: i64,
    args: BriefingRunArgs,
) -> AppResult<Briefing> {
    briefing::run_for_today(state, user_id, args.force.unwrap_or(false)).await
}
