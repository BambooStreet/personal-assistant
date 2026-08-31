use chrono::{DateTime, Datelike, Duration, Local, Months, NaiveDate, NaiveTime, TimeZone, Utc};
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
    // 난이도 '하' | '중' | '상'. 표시 전용 문자열.
    pub difficulty: Option<String>,
    // 연결된 목표. FK가 없어 목표가 지워지면 고아 id가 남는다 — 읽는 쪽이 무시한다.
    pub goal_id: Option<i64>,
    // 반복 할 일의 트리거("자기 전" 등). 빈도(recur)와 별개로 "어떤 상황에서 하는가".
    pub trigger_slot: Option<String>,
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
    /// '하' | '중' | '상'. 칩에 그대로 찍는 표시용 문자열이라 정수 등급으로 두지 않는다.
    #[serde(default)]
    pub difficulty: Option<String>,
    /// 연결된 목표. FK가 없어 목표가 지워지면 고아 id가 남는다 — 읽는 쪽이 무시한다.
    #[serde(default)]
    pub goal_id: Option<i64>,
    /// 반복 할 일의 트리거("일어나자마자" 등). 표시·정렬용 문자열.
    #[serde(default)]
    pub trigger_slot: Option<String>,
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
        difficulty: row.get("difficulty"),
        goal_id: row.get("goal_id"),
        trigger_slot: row.get("trigger_slot"),
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
        "SELECT id, title, notes, due_at, priority, done, done_at, recur, estimated_minutes, difficulty, goal_id, trigger_slot, created_at, updated_at \
         FROM todos WHERE user_id = ? ORDER BY done ASC, COALESCE(due_at, '9999') ASC, priority DESC, id DESC"
    } else {
        "SELECT id, title, notes, due_at, priority, done, done_at, recur, estimated_minutes, difficulty, goal_id, trigger_slot, created_at, updated_at \
         FROM todos WHERE user_id = ? AND done = 0 ORDER BY COALESCE(due_at, '9999') ASC, priority DESC, id DESC"
    };
    let rows = sqlx::query(q).bind(user_id).fetch_all(&state.db).await?;
    Ok(rows.iter().map(row_to_todo).collect())
}

#[derive(Debug, Deserialize)]
pub struct TodosCreateArgs {
    pub draft: TodoDraft,
}

// ===== 마감(due_at) 정규화 =====
//
// LLM이 도구 지침을 반쯤만 따르는 경우가 잦아(제목에 날짜를 남기거나 자정으로 채움) Core에서
// 결정론적으로 보정한다. 규칙:
//   1. 제목 끝의 날짜 표기 — "졸업식(8.21)", "보고서 [8/21]", "발표(2026-08-21)" — 는 떼어낸다.
//   2. 마감이 그 값 자신의 오프셋 기준 자정(00:00)이면 "날짜만 준 것"으로 보고 같은 날짜의
//      **로컬 23:59**로 맞춘다. 시각이 명시된 값(예: 15:00)은 건드리지 않는다.
//   3. 마감이 비어 있는데 제목에 날짜가 있었으면 그 날짜의 로컬 23:59로 채운다.
//      연도가 없으면 오늘 기준 가장 가까운 미래로 해석한다.
fn normalize_due(title: &str, due_at: Option<&str>) -> (String, Option<String>) {
    let (base_title, title_date) = split_trailing_date(title);
    let normalized = match due_at.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => normalize_due_string(raw),
        None => title_date.and_then(local_end_of_day),
    };
    (base_title, normalized)
}

/// 마감 문자열을 규칙 2에 따라 보정. 파싱 실패 시 원본을 그대로 둔다(데이터 손실 방지).
fn normalize_due_string(raw: &str) -> Option<String> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        // 자정 판정은 **그 값 자신의 오프셋 기준**이다. 모델은 같은 "8/21 날짜만"을
        // 2026-08-21T00:00:00Z 로도 +09:00 으로도 보내는데, 둘 다 날짜만 준 것으로 봐야 한다.
        if dt.time() == NaiveTime::MIN {
            return local_end_of_day(dt.date_naive()).or_else(|| Some(raw.to_string()));
        }
        return Some(raw.to_string());
    }
    if let Ok(d) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return local_end_of_day(d).or_else(|| Some(raw.to_string()));
    }
    Some(raw.to_string())
}

/// 해당 날짜의 로컬 23:59 → RFC3339.
fn local_end_of_day(date: NaiveDate) -> Option<String> {
    let naive = date.and_hms_opt(23, 59, 0)?;
    // DST로 존재하지 않거나 모호한 시각이면 가장 이른 해석(KST는 무관).
    let local = Local.from_local_datetime(&naive).earliest()?;
    Some(local.to_rfc3339())
}

/// 제목 끝의 괄호 날짜를 떼어내 (남은 제목, 날짜)로 나눈다. 없으면 (원본 제목, None).
fn split_trailing_date(title: &str) -> (String, Option<NaiveDate>) {
    let trimmed = title.trim();
    let (open, close) = match trimmed.chars().last() {
        Some(')') => ('(', ')'),
        Some(']') => ('[', ']'),
        _ => return (trimmed.to_string(), None),
    };
    let Some(start) = trimmed.rfind(open) else {
        return (trimmed.to_string(), None);
    };
    let inner = &trimmed[start + open.len_utf8()..trimmed.len() - close.len_utf8()];
    let Some(date) = parse_loose_date(inner.trim()) else {
        return (trimmed.to_string(), None);
    };
    let base = trimmed[..start].trim().to_string();
    // 제목이 통째로 날짜였다면 지우지 않는다(빈 제목 방지).
    if base.is_empty() {
        return (trimmed.to_string(), None);
    }
    (base, Some(date))
}

/// "8.21" / "8/21" / "8-21" / "2026-08-21" 형태를 날짜로. 연도가 없으면 가장 가까운 미래.
fn parse_loose_date(s: &str) -> Option<NaiveDate> {
    let parts: Vec<&str> = s
        .split(['.', '/', '-'])
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    if !parts
        .iter()
        .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
    {
        return None;
    }
    let today = Local::now().date_naive();
    match parts.as_slice() {
        [m, d] => {
            let (m, d) = (m.parse::<u32>().ok()?, d.parse::<u32>().ok()?);
            let this_year = NaiveDate::from_ymd_opt(today.year(), m, d)?;
            if this_year < today {
                NaiveDate::from_ymd_opt(today.year() + 1, m, d)
            } else {
                Some(this_year)
            }
        }
        [y, m, d] if y.len() == 4 => NaiveDate::from_ymd_opt(
            y.parse::<i32>().ok()?,
            m.parse::<u32>().ok()?,
            d.parse::<u32>().ok()?,
        ),
        _ => None,
    }
}

pub async fn todos_create(state: &AppState, user_id: i64, args: TodosCreateArgs) -> AppResult<Todo> {
    let title = args.draft.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("empty title".into()));
    }
    // 제목 속 날짜 → 마감으로, 날짜만 준 마감 → 그날 23:59로 (LLM/UI 양쪽 입력에 동일 적용).
    let (title, due_at) = normalize_due(title, args.draft.due_at.as_deref());
    let title = title.as_str();
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
        "INSERT INTO todos (user_id, title, notes, due_at, priority, done, recur, estimated_minutes, difficulty, goal_id, trigger_slot, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(title)
    .bind(&args.draft.notes)
    .bind(&due_at)
    .bind(priority)
    .bind(&recur)
    .bind(args.draft.estimated_minutes)
    .bind(&args.draft.difficulty)
    .bind(args.draft.goal_id)
    .bind(&args.draft.trigger_slot)
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
    // 제목 속 날짜 → 마감으로, 날짜만 준 마감 → 그날 23:59로 (LLM/UI 양쪽 입력에 동일 적용).
    let (title, due_at) = normalize_due(title, args.draft.due_at.as_deref());
    let title = title.as_str();
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
        "UPDATE todos SET title = ?, notes = ?, due_at = ?, priority = ?, recur = ?, estimated_minutes = ?, difficulty = ?, goal_id = ?, trigger_slot = ?, updated_at = ? \
         WHERE id = ? AND user_id = ?",
    )
    .bind(title)
    .bind(&args.draft.notes)
    .bind(&due_at)
    .bind(priority)
    .bind(&recur)
    .bind(args.draft.estimated_minutes)
    .bind(&args.draft.difficulty)
    .bind(args.draft.goal_id)
    .bind(&args.draft.trigger_slot)
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
    /// 반복 할 일을 **끝낸다**. 기본(false)은 기존 동작 — 다음 주기로 전진하고
    /// done=0을 유지해 내일 다시 뜬다. true면 반복이라도 완료로 마감한다.
    #[serde(default)]
    pub finish: Option<bool>,
}

pub async fn todos_complete(state: &AppState, user_id: i64, args: TodosIdArgs) -> AppResult<Todo> {
    let now_dt = Utc::now();
    let now = now_dt.to_rfc3339();
    // 대상 조회 — 없으면 NotFound. recur 여부로 동작 분기.
    let todo = fetch_one(&state.db, user_id, args.id).await?;
    let finish = args.finish.unwrap_or(false);
    if let Some(recur) = todo.recur.as_deref().filter(|s| !s.is_empty()).filter(|_| !finish) {
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

/// 단건 조회. update_todo(부분 수정)가 기존 값을 읽어 병합할 때 쓴다.
pub async fn todos_get(state: &AppState, user_id: i64, id: i64) -> AppResult<Todo> {
    fetch_one(&state.db, user_id, id).await
}

async fn fetch_one(pool: &sqlx::SqlitePool, user_id: i64, id: i64) -> AppResult<Todo> {
    let row = sqlx::query(
        "SELECT id, title, notes, due_at, priority, done, done_at, recur, estimated_minutes, difficulty, goal_id, trigger_slot, created_at, updated_at \
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
    use super::{next_occurrence, normalize_due};
    use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveTime, Utc};

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

    // ===== 마감 정규화 =====

    /// 로컬 23:59인지 확인(타임존 무관하게 검증되도록 로컬로 파싱해 비교).
    fn is_local_2359(rfc: &str, y: i32, m: u32, d: u32) -> bool {
        let dt = DateTime::parse_from_rfc3339(rfc).expect("rfc3339").with_timezone(&Local);
        dt.date_naive() == NaiveDate::from_ymd_opt(y, m, d).unwrap()
            && dt.time() == NaiveTime::from_hms_opt(23, 59, 0).unwrap()
    }

    #[test]
    fn title_date_moves_to_due() {
        // 제목에 날짜가 남고 마감이 비면 → 제목에서 떼고 그날 23:59로.
        let (title, due) = normalize_due("졸업식(8.21)", None);
        assert_eq!(title, "졸업식");
        let due = due.expect("due 채워짐");
        let year = Local::now().date_naive().year();
        assert!(is_local_2359(&due, year, 8, 21) || is_local_2359(&due, year + 1, 8, 21));
    }

    #[test]
    fn utc_midnight_due_becomes_local_end_of_day() {
        // 모델이 흔히 보내는 "날짜만" 표기(UTC 자정) → 그 날짜의 로컬 23:59.
        let (title, due) = normalize_due("졸업식", Some("2026-08-21T00:00:00.000Z"));
        assert_eq!(title, "졸업식");
        assert!(is_local_2359(&due.unwrap(), 2026, 8, 21));
    }

    #[test]
    fn explicit_time_is_preserved() {
        // 시각이 명시된 마감은 건드리지 않는다.
        let (_, due) = normalize_due("경포대마라톤", Some("2026-10-10T15:00:00+09:00"));
        assert_eq!(due.as_deref(), Some("2026-10-10T15:00:00+09:00"));
    }

    #[test]
    fn date_only_string_is_expanded() {
        let (_, due) = normalize_due("보고서", Some("2026-08-21"));
        assert!(is_local_2359(&due.unwrap(), 2026, 8, 21));
    }

    #[test]
    fn non_date_parens_are_kept() {
        // 날짜가 아닌 괄호는 제목의 일부 — 떼지 않는다.
        let (title, due) = normalize_due("논문 리비전(재심사)", None);
        assert_eq!(title, "논문 리비전(재심사)");
        assert!(due.is_none());
    }

    #[test]
    fn title_that_is_only_a_date_is_untouched() {
        // 제목이 통째로 날짜면 지우지 않는다(빈 제목 방지).
        let (title, _) = normalize_due("(8.21)", None);
        assert_eq!(title, "(8.21)");
    }

    #[test]
    fn full_date_in_title_uses_that_year() {
        let (title, due) = normalize_due("발표(2026-08-21)", None);
        assert_eq!(title, "발표");
        assert!(is_local_2359(&due.unwrap(), 2026, 8, 21));
    }
}
