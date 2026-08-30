use serde::Deserialize;

use crate::error::AppResult;
use crate::services::greeting::{self, GreetingOutcome};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct GreetingRunArgs {
    /// 쿨다운을 무시하고 무조건 인사한다. 디버그·수동 트리거용.
    #[serde(default)]
    pub force: Option<bool>,
}

pub async fn greeting_run(
    state: &AppState,
    user_id: i64,
    args: GreetingRunArgs,
) -> AppResult<GreetingOutcome> {
    greeting::run(state, user_id, args.force.unwrap_or(false)).await
}
