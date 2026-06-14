use chrono::{DateTime, Duration, Months, Utc};
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
    // 반복 주기. null = 일회성, 'daily' | 'weekly' | 'monthly'.
    pub recur: Option<String>,
    // 예상 소요시간(분). null = 미입력.
    pub estimated_minutes: Option<i64>,
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
    #[serde(default)]
    pub recur: Option<String>,
    #[serde(default)]
    pub estimated_minutes: Option<i64>,
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
        recur: row.get("recur"),
        estimated_minutes: row.get("estimated_minutes"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

// 반복 todo의 다음 발생 시각. base에서 주기를 더하되, 밀린 주기는 now를 넘어설 때까지 건너뛴다.
// (최소 한 번은 전진하므로 오늘 완료 시 다음 주기로 넘어감.)
fn next_occurrence(base: DateTime<Utc>, recur: &str, now: DateTime<Utc>) -> DateTime<Utc> {
    let mut next = base;
    loop {
        next = match recur {
            "weekly" => next + Duration::days(7),
            "monthly" => next
                .checked_add_months(Months::new(1))
                .unwrap_or(next + Duration::days(30)),
            // 'daily' 및 알 수 없는 값은 매일로 취급.
            _ => next + Duration::days(1),
        };
        if next > now {
            break;
        }
    }
    next
}

#[derive(Debug, Deserialize)]
pub struct TodosListArgs {
    #[serde(default)]
    pub include_done: Option<bool>,
}

pub async fn todos_list(
    state: &AppState,
    user_id: i64,
    args: TodosListArgs,
) -> AppResult<Vec<Todo>> {
    let include = args.include_done.unwrap_or(false);
    let q = if include {
        "SELECT id, title, notes, due_at, priority, done, done_at, recur, estimated_minutes, created_at, updated_at \
         FROM todos WHERE user_id = ? ORDER BY done ASC, COALESCE(due_at, '9999') ASC, priority DESC, id DESC"
    } else {
        "SELECT id, title, notes, due_at, priority, done, done_at, recur, estimated_minutes, created_at, updated_at \
         FROM todos WHERE user_id = ? AND done = 0 ORDER BY COALESCE(due_at, '9999') ASC, priority DESC, id DESC"
    };
    let rows = sqlx::query(q).bind(user_id).fetch_all(&state.db).await?;
    Ok(rows.iter().map(row_to_todo).collect())
}

#[derive(Debug, Deserialize)]
pub struct TodosCreateArgs {
    pub draft: TodoDraft,
}

pub async fn todos_create(state: &AppState, user_id: i64, args: TodosCreateArgs) -> AppResult<Todo> {
    let title = args.draft.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("empty title".into()));
    }
    let now = Utc::now().to_rfc3339();
    let priority = args.draft.priority.unwrap_or(0).clamp(0, 3);
    // 빈 문자열은 일회성(null)으로 정규화.
    let recur = args
        .draft
        .recur
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let id = sqlx::query(
        "INSERT INTO todos (user_id, title, notes, due_at, priority, done, recur, estimated_minutes, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(title)
    .bind(&args.draft.notes)
    .bind(&args.draft.due_at)
    .bind(priority)
    .bind(&recur)
    .bind(args.draft.estimated_minutes)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?
    .last_insert_rowid();
    fetch_one(&state.db, user_id, id).await
}

#[derive(Debug, Deserialize)]
pub struct TodosUpdateArgs {
    pub id: i64,
    pub draft: TodoDraft,
}

// 편집: 제목/노트/기한/우선순위/반복을 draft 값으로 전체 교체(done 상태는 유지).
// 누락 필드는 null로 간주 — UI가 항상 현재 값을 모두 채워 보내는 전제.
pub async fn todos_update(state: &AppState, user_id: i64, args: TodosUpdateArgs) -> AppResult<Todo> {
    let title = args.draft.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("empty title".into()));
    }
    let now = Utc::now().to_rfc3339();
    let priority = args.draft.priority.unwrap_or(0).clamp(0, 3);
    let recur = args
        .draft
        .recur
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let res = sqlx::query(
        "UPDATE todos SET title = ?, notes = ?, due_at = ?, priority = ?, recur = ?, estimated_minutes = ?, updated_at = ? \
         WHERE id = ? AND user_id = ?",
    )
    .bind(title)
    .bind(&args.draft.notes)
    .bind(&args.draft.due_at)
    .bind(priority)
    .bind(&recur)
    .bind(args.draft.estimated_minutes)
    .bind(&now)
    .bind(args.id)
    .bind(user_id)
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("todo {}", args.id)));
    }
    fetch_one(&state.db, user_id, args.id).await
}

#[derive(Debug, Deserialize)]
pub struct TodosIdArgs {
    pub id: i64,
}

pub async fn todos_complete(state: &AppState, user_id: i64, args: TodosIdArgs) -> AppResult<Todo> {
    let now_dt = Utc::now();
    let now = now_dt.to_rfc3339();
    // 대상 조회 — 없으면 NotFound. recur 여부로 동작 분기.
    let todo = fetch_one(&state.db, user_id, args.id).await?;
    if let Some(recur) = todo.recur.as_deref().filter(|s| !s.is_empty()) {
        // 반복 todo: 완료로 끝내지 않고 due_at을 다음 주기로 전진(done=0 유지) → 다음 주기에 재등장.
        // done_at에는 마지막 완료 시각을 기록.
        let base = todo
            .due_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or(now_dt);
        let next = next_occurrence(base, recur, now_dt).to_rfc3339();
        sqlx::query(
            "UPDATE todos SET due_at = ?, done = 0, done_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        )
        .bind(&next)
        .bind(&now)
        .bind(&now)
        .bind(args.id)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query("UPDATE todos SET done = 1, done_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
            .bind(&now)
            .bind(&now)
            .bind(args.id)
            .bind(user_id)
            .execute(&state.db)
            .await?;
    }
    fetch_one(&state.db, user_id, args.id).await
}

pub async fn todos_uncomplete(state: &AppState, user_id: i64, args: TodosIdArgs) -> AppResult<Todo> {
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE todos SET done = 0, done_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(&now)
    .bind(args.id)
    .bind(user_id)
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("todo {}", args.id)));
    }
    fetch_one(&state.db, user_id, args.id).await
}

pub async fn todos_delete(state: &AppState, user_id: i64, args: TodosIdArgs) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM todos WHERE id = ? AND user_id = ?")
        .bind(args.id)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("todo {}", args.id)));
    }
    Ok(())
}

async fn fetch_one(pool: &sqlx::SqlitePool, user_id: i64, id: i64) -> AppResult<Todo> {
    let row = sqlx::query(
        "SELECT id, title, notes, due_at, priority, done, done_at, recur, estimated_minutes, created_at, updated_at \
         FROM todos WHERE id = ? AND user_id = ?",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("todo {id}")))?;
    Ok(row_to_todo(&row))
}

#[cfg(test)]
mod tests {
    use super::next_occurrence;
    use chrono::{DateTime, Utc};

    fn dt(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn daily_advances_one_day() {
        let base = dt("2026-06-10T09:00:00Z");
        let now = dt("2026-06-10T10:00:00Z"); // 오늘, base 이후
        let next = next_occurrence(base, "daily", now);
        assert_eq!(next, dt("2026-06-11T09:00:00Z"));
    }

    #[test]
    fn weekly_advances_seven_days() {
        let base = dt("2026-06-10T09:00:00Z");
        let now = dt("2026-06-10T09:00:00Z");
        let next = next_occurrence(base, "weekly", now);
        assert_eq!(next, dt("2026-06-17T09:00:00Z"));
    }

    #[test]
    fn monthly_advances_one_month() {
        let base = dt("2026-06-10T09:00:00Z");
        let now = dt("2026-06-10T09:00:00Z");
        let next = next_occurrence(base, "monthly", now);
        assert_eq!(next, dt("2026-07-10T09:00:00Z"));
    }

    #[test]
    fn skips_missed_periods_until_future() {
        // base가 5일 전 daily면 now 다음날로 점프(중간 주기 건너뜀).
        let base = dt("2026-06-05T09:00:00Z");
        let now = dt("2026-06-10T10:00:00Z");
        let next = next_occurrence(base, "daily", now);
        assert_eq!(next, dt("2026-06-11T09:00:00Z"));
    }

    #[test]
    fn monthly_clamps_end_of_month() {
        // 1/31 + 1개월 = 2/28 (chrono checked_add_months 동작).
        let base = dt("2026-01-31T09:00:00Z");
        let now = dt("2026-01-31T09:00:00Z");
        let next = next_occurrence(base, "monthly", now);
        assert_eq!(next, dt("2026-02-28T09:00:00Z"));
    }

    #[test]
    fn unknown_recur_treated_as_daily() {
        let base = dt("2026-06-10T09:00:00Z");
        let now = dt("2026-06-10T09:00:00Z");
        let next = next_occurrence(base, "bogus", now);
        assert_eq!(next, dt("2026-06-11T09:00:00Z"));
    }
}
