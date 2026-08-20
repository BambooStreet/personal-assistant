//! 목표/루틴 RPC 표면. 로직은 전부 `services::goals`에 있다 — 스케줄러와 브리핑도 같은 함수를
//! 쓰기 때문(`commands/briefing.rs`와 같은 얇은 wrapper 패턴).

use serde::Deserialize;

use crate::error::AppResult;
use crate::services::goals::{self, GoalDetail, GoalDraft, GoalRoutine, RoutineDraft, RoutinePatch};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct GoalsCreateArgs {
    pub draft: GoalDraft,
}

#[derive(Debug, Deserialize)]
pub struct GoalsUpdateArgs {
    pub id: i64,
    pub draft: GoalDraft,
}

/// id 하나만 받는 커맨드 공용.
#[derive(Debug, Deserialize)]
pub struct GoalsIdArgs {
    pub id: i64,
}

#[derive(Debug, Deserialize)]
pub struct RoutineCreateArgs {
    pub draft: RoutineDraft,
}

#[derive(Debug, Deserialize)]
pub struct RoutineUpdateArgs {
    pub id: i64,
    pub draft: RoutinePatch,
}

pub async fn goals_list(state: &AppState, user_id: i64) -> AppResult<Vec<GoalDetail>> {
    goals::list(state, user_id).await
}

pub async fn goals_create(
    state: &AppState,
    user_id: i64,
    args: GoalsCreateArgs,
) -> AppResult<GoalDetail> {
    goals::create(state, user_id, args.draft).await
}

pub async fn goals_update(
    state: &AppState,
    user_id: i64,
    args: GoalsUpdateArgs,
) -> AppResult<GoalDetail> {
    goals::update(state, user_id, args.id, args.draft).await
}

pub async fn goals_delete(state: &AppState, user_id: i64, args: GoalsIdArgs) -> AppResult<()> {
    goals::delete(state, user_id, args.id).await
}

pub async fn goals_routine_create(
    state: &AppState,
    user_id: i64,
    args: RoutineCreateArgs,
) -> AppResult<GoalRoutine> {
    goals::routine_create(state, user_id, args.draft).await
}

pub async fn goals_routine_update(
    state: &AppState,
    user_id: i64,
    args: RoutineUpdateArgs,
) -> AppResult<GoalRoutine> {
    goals::routine_update(state, user_id, args.id, args.draft).await
}

pub async fn goals_routine_delete(
    state: &AppState,
    user_id: i64,
    args: GoalsIdArgs,
) -> AppResult<()> {
    goals::routine_delete(state, user_id, args.id).await
}
