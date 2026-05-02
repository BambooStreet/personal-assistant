use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Todo {
    pub id: i64,
    pub title: String,
    pub notes: Option<String>,
    pub due_at: Option<String>,
    pub priority: i64,
    pub done: bool,
    pub done_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct TodoDraft {
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
}

fn row_to_todo(row: &sqlx::sqlite::SqliteRow) -> Todo {
    Todo {
        id: row.get("id"),
        title: row.get("title"),
        notes: row.get("notes"),
        due_at: row.get("due_at"),
        priority: row.get("priority"),
        done: row.get::<i64, _>("done") != 0,
        done_at: row.get("done_at"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

#[derive(Debug, Deserialize)]
pub struct TodosListArgs {
    #[serde(default)]
    pub include_done: Option<bool>,
}

pub async fn todos_list(state: &AppState, args: TodosListArgs) -> AppResult<Vec<Todo>> {
    let include = args.include_done.unwrap_or(false);
    let q = if include {
        "SELECT id, title, notes, due_at, priority, done, done_at, created_at, updated_at \
         FROM todos ORDER BY done ASC, COALESCE(due_at, '9999') ASC, priority DESC, id DESC"
    } else {
        "SELECT id, title, notes, due_at, priority, done, done_at, created_at, updated_at \
         FROM todos WHERE done = 0 ORDER BY COALESCE(due_at, '9999') ASC, priority DESC, id DESC"
    };
    let rows = sqlx::query(q).fetch_all(&state.db).await?;
    Ok(rows.iter().map(row_to_todo).collect())
}

#[derive(Debug, Deserialize)]
pub struct TodosCreateArgs {
    pub draft: TodoDraft,
}

pub async fn todos_create(state: &AppState, args: TodosCreateArgs) -> AppResult<Todo> {
    let title = args.draft.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("empty title".into()));
    }
    let now = Utc::now().to_rfc3339();
    let priority = args.draft.priority.unwrap_or(0).clamp(0, 3);
    let id = sqlx::query(
        "INSERT INTO todos (title, notes, due_at, priority, done, created_at, updated_at) \
         VALUES (?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(title)
    .bind(&args.draft.notes)
    .bind(&args.draft.due_at)
    .bind(priority)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?
    .last_insert_rowid();
    fetch_one(&state.db, id).await
}

#[derive(Debug, Deserialize)]
pub struct TodosIdArgs {
    pub id: i64,
}

pub async fn todos_complete(state: &AppState, args: TodosIdArgs) -> AppResult<Todo> {
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE todos SET done = 1, done_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&now)
    .bind(&now)
    .bind(args.id)
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("todo {}", args.id)));
    }
    fetch_one(&state.db, args.id).await
}

pub async fn todos_uncomplete(state: &AppState, args: TodosIdArgs) -> AppResult<Todo> {
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE todos SET done = 0, done_at = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(&now)
    .bind(args.id)
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("todo {}", args.id)));
    }
    fetch_one(&state.db, args.id).await
}

pub async fn todos_delete(state: &AppState, args: TodosIdArgs) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM todos WHERE id = ?")
        .bind(args.id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("todo {}", args.id)));
    }
    Ok(())
}

async fn fetch_one(pool: &sqlx::SqlitePool, id: i64) -> AppResult<Todo> {
    let row = sqlx::query(
        "SELECT id, title, notes, due_at, priority, done, done_at, created_at, updated_at \
         FROM todos WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("todo {id}")))?;
    Ok(row_to_todo(&row))
}
