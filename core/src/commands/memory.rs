use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::services::memory::{self, Memory};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MemoryRememberArgs {
    pub content: String,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub conversation_id: Option<String>,
}

pub async fn memory_remember(
    state: &AppState,
    args: MemoryRememberArgs,
) -> AppResult<Memory> {
    let tags = args.tags.unwrap_or_default();
    memory::insert(
        &state.db,
        &args.content,
        &tags,
        args.conversation_id.as_deref(),
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct MemorySearchArgs {
    pub query: String,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct MemorySearchResponse {
    pub memories: Vec<Memory>,
}

pub async fn memory_search(
    state: &AppState,
    args: MemorySearchArgs,
) -> AppResult<MemorySearchResponse> {
    let lim = args.limit.unwrap_or(3);
    let memories = memory::search(&state.db, &args.query, lim).await?;
    Ok(MemorySearchResponse { memories })
}
