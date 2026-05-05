use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: i64,
    pub content: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

fn row_to_memory(row: &sqlx::sqlite::SqliteRow) -> Memory {
    let tags_raw: Option<String> = row.get("tags");
    let tags: Vec<String> = tags_raw
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    Memory {
        id: row.get("id"),
        content: row.get("content"),
        tags,
        created_at: row.get("created_at"),
        last_used_at: row.get("last_used_at"),
    }
}

pub async fn insert(
    pool: &sqlx::SqlitePool,
    content: &str,
    tags: &[String],
    source_conversation: Option<&str>,
) -> AppResult<Memory> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("memory content empty".into()));
    }
    let now = Utc::now().to_rfc3339();
    let tags_json = serde_json::to_string(tags)?;
    let id = sqlx::query(
        "INSERT INTO memories (content, tags, source_conversation, created_at, last_used_at) \
         VALUES (?, ?, ?, ?, NULL)",
    )
    .bind(trimmed)
    .bind(&tags_json)
    .bind(source_conversation)
    .bind(&now)
    .execute(pool)
    .await?
    .last_insert_rowid();

    fetch_one(pool, id).await
}

pub async fn search(
    pool: &sqlx::SqlitePool,
    query: &str,
    limit: i64,
) -> AppResult<Vec<Memory>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let lim = limit.clamp(1, 20);
    let pattern = format!("%{}%", q);
    let rows = sqlx::query(
        "SELECT id, content, tags, created_at, last_used_at \
         FROM memories \
         WHERE content LIKE ? OR (tags IS NOT NULL AND tags LIKE ?) \
         ORDER BY COALESCE(last_used_at, created_at) DESC \
         LIMIT ?",
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(lim)
    .fetch_all(pool)
    .await?;

    let memories: Vec<Memory> = rows.iter().map(row_to_memory).collect();

    // 매치된 항목의 last_used_at 갱신 (LRU 우선순위 위해).
    if !memories.is_empty() {
        let now = Utc::now().to_rfc3339();
        for m in &memories {
            sqlx::query("UPDATE memories SET last_used_at = ? WHERE id = ?")
                .bind(&now)
                .bind(m.id)
                .execute(pool)
                .await?;
        }
    }

    Ok(memories)
}

async fn fetch_one(pool: &sqlx::SqlitePool, id: i64) -> AppResult<Memory> {
    let row = sqlx::query(
        "SELECT id, content, tags, created_at, last_used_at FROM memories WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("memory {id}")))?;
    Ok(row_to_memory(&row))
}
