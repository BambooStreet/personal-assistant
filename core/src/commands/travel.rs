use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::travel::{self, Leg};
use crate::state::AppState;

/// 등록된 장소 별칭("집"/"회사"/"학교"+커스텀). lat/lng는 사전 지오코딩 결과(없을 수 있음).
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PlaceAlias {
    pub alias: String,
    pub query: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

pub async fn travel_alias_list(state: &AppState, user_id: i64) -> AppResult<Vec<PlaceAlias>> {
    let rows = sqlx::query_as::<_, PlaceAlias>(
        "SELECT alias, query, lat, lng FROM place_alias WHERE user_id = ? ORDER BY alias ASC",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows)
}

#[derive(Debug, Deserialize)]
pub struct AliasSetArgs {
    pub alias: String,
    pub query: String,
}

pub async fn travel_alias_set(
    state: &AppState,
    user_id: i64,
    args: AliasSetArgs,
) -> AppResult<PlaceAlias> {
    let alias = args.alias.trim().to_string();
    let query = args.query.trim().to_string();
    if alias.is_empty() || query.is_empty() {
        return Err(AppError::InvalidInput("alias/query는 비울 수 없습니다".into()));
    }
    // 사전 지오코딩(실패는 무시 — 좌표 없이 저장하고 알림 시점에 재시도).
    let coord = match travel::geocode_text(state, user_id, &query).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, alias, "별칭 사전 지오코딩 실패");
            None
        }
    };
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR REPLACE INTO place_alias (user_id, alias, query, lat, lng, created_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(&alias)
    .bind(&query)
    .bind(coord.map(|c| c.0))
    .bind(coord.map(|c| c.1))
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(PlaceAlias {
        alias,
        query,
        lat: coord.map(|c| c.0),
        lng: coord.map(|c| c.1),
    })
}

#[derive(Debug, Deserialize)]
pub struct AliasDeleteArgs {
    pub alias: String,
}

pub async fn travel_alias_delete(
    state: &AppState,
    user_id: i64,
    args: AliasDeleteArgs,
) -> AppResult<()> {
    sqlx::query("DELETE FROM place_alias WHERE user_id = ? AND alias = ?")
        .bind(user_id)
        .bind(args.alias.trim())
        .execute(&state.db)
        .await?;
    Ok(())
}

pub async fn travel_today(state: &AppState, user_id: i64) -> AppResult<Vec<Leg>> {
    travel::plan_today_travel(state, user_id).await
}
