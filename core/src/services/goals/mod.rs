//! 목표 + 루틴 알림.
//!
//! 로직이 services에 있는 이유: 커맨드 말고도 호출자가 둘 더 있다 —
//! 알림 스케줄러(`routines_tick`)와 브리핑 서비스(`briefing_lines`).
//! `commands/goals.rs`는 RPC 표면만 담당하는 얇은 wrapper다.
//!
//! FK가 없는 스키마라 **삭제 캐스케이드를 여기서 수동 처리**한다(순서 주의).

pub mod notify;
pub mod pure;

use chrono::{Datelike, Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

// ===== 모델 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalWhy {
    pub id: i64,
    pub goal_id: i64,
    pub text: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalRoutine {
    pub id: i64,
    pub goal_id: i64,
    pub time_hhmm: String,
    pub days_mask: i64,
    /// "매일" / "평일" / "월수금" — 렌더러가 포맷을 복제하지 않도록 Core가 만들어 준다.
    pub days_label: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalDetail {
    pub id: i64,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub whys: Vec<GoalWhy>,
    pub routines: Vec<GoalRoutine>,
}

#[derive(Debug, Deserialize)]
pub struct GoalDraft {
    pub title: String,
    #[serde(default)]
    pub whys: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct RoutineDraft {
    pub goal_id: i64,
    pub time_hhmm: String,
    pub days_mask: i64,
}

#[derive(Debug, Deserialize)]
pub struct RoutinePatch {
    #[serde(default)]
    pub time_hhmm: Option<String>,
    #[serde(default)]
    pub days_mask: Option<i64>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

fn row_to_why(row: &sqlx::sqlite::SqliteRow) -> GoalWhy {
    GoalWhy {
        id: row.get("id"),
        goal_id: row.get("goal_id"),
        text: row.get("text"),
        sort_order: row.get("sort_order"),
    }
}

fn row_to_routine(row: &sqlx::sqlite::SqliteRow) -> GoalRoutine {
    let days_mask: i64 = row.get("days_mask");
    GoalRoutine {
        id: row.get("id"),
        goal_id: row.get("goal_id"),
        time_hhmm: row.get("time_hhmm"),
        days_mask,
        days_label: pure::format_days(days_mask),
        enabled: row.get::<i64, _>("enabled") != 0,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

// ===== 검증 =====

fn clean_title(raw: &str) -> AppResult<String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(AppError::InvalidInput("목표 제목이 비어 있어요".into()));
    }
    Ok(t.to_string())
}

/// 검증 + 시각 정규화("7:00" → "07:00"). 정규화된 값을 저장해야 문자열 정렬이 시간순이 된다.
fn check_routine_input(time_hhmm: &str, days_mask: i64) -> AppResult<String> {
    let Some(t) = pure::normalize_hhmm(time_hhmm) else {
        return Err(AppError::InvalidInput(
            "시각은 HH:MM 형식이어야 해요".into(),
        ));
    };
    if !(1..=pure::DAILY_MASK).contains(&days_mask) {
        return Err(AppError::InvalidInput("요일을 하나 이상 골라 주세요".into()));
    }
    Ok(t)
}

// ===== 조회 =====

pub async fn list(state: &AppState, user_id: i64) -> AppResult<Vec<GoalDetail>> {
    let goal_rows = sqlx::query(
        "SELECT id, title, created_at, updated_at FROM goals WHERE user_id = ? ORDER BY id ASC",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    let mut out = Vec::with_capacity(goal_rows.len());
    for g in &goal_rows {
        let id: i64 = g.get("id");
        out.push(GoalDetail {
            id,
            title: g.get("title"),
            created_at: g.get("created_at"),
            updated_at: g.get("updated_at"),
            whys: load_whys(state, user_id, id).await?,
            routines: load_routines(state, user_id, id).await?,
        });
    }
    Ok(out)
}

async fn load_whys(state: &AppState, user_id: i64, goal_id: i64) -> AppResult<Vec<GoalWhy>> {
    let rows = sqlx::query(
        "SELECT id, goal_id, text, sort_order FROM goal_whys \
         WHERE user_id = ? AND goal_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .bind(user_id)
    .bind(goal_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows.iter().map(row_to_why).collect())
}

async fn load_routines(
    state: &AppState,
    user_id: i64,
    goal_id: i64,
) -> AppResult<Vec<GoalRoutine>> {
    let rows = sqlx::query(
        "SELECT id, goal_id, time_hhmm, days_mask, enabled, created_at, updated_at \
         FROM goal_routines WHERE user_id = ? AND goal_id = ? ORDER BY time_hhmm ASC, id ASC",
    )
    .bind(user_id)
    .bind(goal_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows.iter().map(row_to_routine).collect())
}

async fn fetch_detail(state: &AppState, user_id: i64, id: i64) -> AppResult<GoalDetail> {
    let g = sqlx::query(
        "SELECT id, title, created_at, updated_at FROM goals WHERE id = ? AND user_id = ?",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("goal {id}")))?;

    Ok(GoalDetail {
        id,
        title: g.get("title"),
        created_at: g.get("created_at"),
        updated_at: g.get("updated_at"),
        whys: load_whys(state, user_id, id).await?,
        routines: load_routines(state, user_id, id).await?,
    })
}

async fn fetch_routine(state: &AppState, user_id: i64, id: i64) -> AppResult<GoalRoutine> {
    let row = sqlx::query(
        "SELECT id, goal_id, time_hhmm, days_mask, enabled, created_at, updated_at \
         FROM goal_routines WHERE id = ? AND user_id = ?",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("routine {id}")))?;
    Ok(row_to_routine(&row))
}

// ===== 쓰기 =====

pub async fn create(state: &AppState, user_id: i64, draft: GoalDraft) -> AppResult<GoalDetail> {
    let title = clean_title(&draft.title)?;
    let now = Utc::now().to_rfc3339();

    let id = sqlx::query(
        "INSERT INTO goals (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(&title)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?
    .last_insert_rowid();

    replace_whys(state, user_id, id, &draft.whys, &now).await?;
    fetch_detail(state, user_id, id).await
}

/// todos와 마찬가지로 draft 전체 교체. whys도 통째로 갈아끼운다.
pub async fn update(
    state: &AppState,
    user_id: i64,
    id: i64,
    draft: GoalDraft,
) -> AppResult<GoalDetail> {
    let title = clean_title(&draft.title)?;
    let now = Utc::now().to_rfc3339();

    let res = sqlx::query("UPDATE goals SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(&title)
        .bind(&now)
        .bind(id)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("goal {id}")));
    }

    replace_whys(state, user_id, id, &draft.whys, &now).await?;
    fetch_detail(state, user_id, id).await
}

async fn replace_whys(
    state: &AppState,
    user_id: i64,
    goal_id: i64,
    whys: &[String],
    now: &str,
) -> AppResult<()> {
    sqlx::query("DELETE FROM goal_whys WHERE user_id = ? AND goal_id = ?")
        .bind(user_id)
        .bind(goal_id)
        .execute(&state.db)
        .await?;

    for (i, raw) in whys.iter().enumerate() {
        let text = raw.trim();
        if text.is_empty() {
            continue;
        }
        // UNIQUE(goal_id, text) — 같은 '왜'를 두 번 넣으면 로테이션에서 그것만 두 배로 나온다.
        // 중복은 에러가 아니라 무시.
        sqlx::query(
            "INSERT OR IGNORE INTO goal_whys (user_id, goal_id, text, sort_order, created_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(goal_id)
        .bind(text)
        .bind(i as i64)
        .bind(now)
        .execute(&state.db)
        .await?;
    }
    Ok(())
}

/// FK가 없으므로 캐스케이드를 손으로. 순서 주의 — routines를 먼저 지우면 routine_id를 못 구한다.
pub async fn delete(state: &AppState, user_id: i64, id: i64) -> AppResult<()> {
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "DELETE FROM routine_notifications_sent WHERE routine_id IN \
         (SELECT id FROM goal_routines WHERE goal_id = ? AND user_id = ?)",
    )
    .bind(id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM goal_routines WHERE goal_id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM goal_whys WHERE goal_id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    let res = sqlx::query("DELETE FROM goals WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("goal {id}")));
    }

    tx.commit().await?;
    Ok(())
}

pub async fn routine_create(
    state: &AppState,
    user_id: i64,
    draft: RoutineDraft,
) -> AppResult<GoalRoutine> {
    let time_hhmm = check_routine_input(&draft.time_hhmm, draft.days_mask)?;
    // 목표 존재 확인(테넌시 포함).
    fetch_detail(state, user_id, draft.goal_id).await?;
    ensure_no_duplicate(state, user_id, draft.goal_id, &time_hhmm, draft.days_mask, None).await?;

    let now = Utc::now().to_rfc3339();
    let id = sqlx::query(
        "INSERT INTO goal_routines (user_id, goal_id, time_hhmm, days_mask, enabled, created_at, updated_at) \
         VALUES (?, ?, ?, ?, 1, ?, ?)",
    )
    .bind(user_id)
    .bind(draft.goal_id)
    .bind(&time_hhmm)
    .bind(draft.days_mask)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?
    .last_insert_rowid();

    fetch_routine(state, user_id, id).await
}

pub async fn routine_update(
    state: &AppState,
    user_id: i64,
    id: i64,
    patch: RoutinePatch,
) -> AppResult<GoalRoutine> {
    let cur = fetch_routine(state, user_id, id).await?;
    let raw_time = patch.time_hhmm.unwrap_or(cur.time_hhmm);
    let days_mask = patch.days_mask.unwrap_or(cur.days_mask);
    let enabled = patch.enabled.unwrap_or(cur.enabled);
    let time_hhmm = check_routine_input(&raw_time, days_mask)?;
    ensure_no_duplicate(state, user_id, cur.goal_id, &time_hhmm, days_mask, Some(id)).await?;

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE goal_routines SET time_hhmm = ?, days_mask = ?, enabled = ?, updated_at = ? \
         WHERE id = ? AND user_id = ?",
    )
    .bind(&time_hhmm)
    .bind(days_mask)
    .bind(if enabled { 1 } else { 0 })
    .bind(&now)
    .bind(id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    // 시각이 바뀌면 오늘치 디듑을 지워 새 시각에 다시 울릴 수 있게 한다.
    sqlx::query("DELETE FROM routine_notifications_sent WHERE routine_id = ? AND date = ?")
        .bind(id)
        .bind(Local::now().format("%Y-%m-%d").to_string())
        .execute(&state.db)
        .await?;

    fetch_routine(state, user_id, id).await
}

pub async fn routine_delete(state: &AppState, user_id: i64, id: i64) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM goal_routines WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("routine {id}")));
    }
    sqlx::query("DELETE FROM routine_notifications_sent WHERE routine_id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(())
}

/// UNIQUE(goal_id, time_hhmm, days_mask) 위반이 sqlx 에러로 새면 메시지가 흉하다 — 미리 잡는다.
async fn ensure_no_duplicate(
    state: &AppState,
    user_id: i64,
    goal_id: i64,
    time_hhmm: &str,
    days_mask: i64,
    exclude_id: Option<i64>,
) -> AppResult<()> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM goal_routines \
         WHERE user_id = ? AND goal_id = ? AND time_hhmm = ? AND days_mask = ? AND id != ? \
         LIMIT 1",
    )
    .bind(user_id)
    .bind(goal_id)
    .bind(time_hhmm)
    .bind(days_mask)
    .bind(exclude_id.unwrap_or(-1))
    .fetch_optional(&state.db)
    .await?;
    if found.is_some() {
        return Err(AppError::InvalidInput("같은 루틴이 이미 있어요".into()));
    }
    Ok(())
}

// ===== 아침 브리핑 줄 =====

/// 오늘 해당하는 루틴만, 시각 오름차순. LLM 없이 코드가 만든다.
/// 브리핑 캐시에 저장하지 않고 호출 때마다 재계산 — 아침에 목표를 추가해도 즉시 반영된다.
pub async fn briefing_lines(state: &AppState, user_id: i64) -> AppResult<Vec<String>> {
    let now = Local::now();
    let today_bit = pure::today_bit(now.weekday());
    let epoch_day = now.date_naive().num_days_from_ce() as i64;

    let goals = list(state, user_id).await?;
    // (정렬키, 줄). 시각 없는 목표는 맨 뒤로.
    let mut rows: Vec<(String, String)> = Vec::new();

    for g in goals {
        let texts: Vec<String> = g.whys.iter().map(|w| w.text.clone()).collect();
        let why = pure::pick_why(&texts, epoch_day);

        let today: Vec<&GoalRoutine> = g
            .routines
            .iter()
            .filter(|r| r.enabled && pure::mask_contains(r.days_mask, today_bit))
            .collect();

        if today.is_empty() {
            // 루틴이 아예 없는 목표는 존재를 알린다(만들었는데 아무 데도 안 보이면 이상하다).
            // 루틴은 있지만 오늘이 아니면 오늘 할 일이 아니므로 건너뛴다.
            if g.routines.is_empty() {
                rows.push((
                    "~".into(),
                    pure::format_briefing_line(&g.title, 0, None, why),
                ));
            }
            continue;
        }
        for r in today {
            rows.push((
                r.time_hhmm.clone(),
                pure::format_briefing_line(&g.title, r.days_mask, Some(&r.time_hhmm), why),
            ));
        }
    }

    rows.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(rows.into_iter().map(|(_, line)| line).collect())
}

// ===== 루틴 알림 발화 =====

/// `notifications::tick`의 **형제**. 그 함수는 DND면 통째로 early return 하는데,
/// 루틴은 사용자가 직접 정한 시각이라 DND를 통과해야 해서 안에 넣을 수 없다.
/// 여기서는 DND를 아예 읽지 않는다 — 통과가 기본값이라 조건문 자체가 없다.
///
/// 단 마스터 스위치(`notifications.enabled`)는 존중한다. "알림 전부 끄기"를 눌렀는데
/// 루틴만 울리면 그게 버그다.
pub async fn routines_tick(state: &AppState, user_id: i64) -> AppResult<()> {
    if !get_bool_setting(state, user_id, "notifications.enabled", true).await? {
        return Ok(());
    }

    let now = Local::now();
    let now_naive = now.naive_local();
    let today_bit = pure::today_bit(now.weekday());
    let today_date = now.format("%Y-%m-%d").to_string();

    // 오늘 요일에 해당하는 것만 DB에서 걸러 온다(비트마스크의 값).
    let rows = sqlx::query(
        "SELECT r.id, r.goal_id, r.time_hhmm, r.days_mask, g.title \
         FROM goal_routines r \
         JOIN goals g ON g.id = r.goal_id AND g.user_id = r.user_id \
         WHERE r.user_id = ? AND r.enabled = 1 AND (r.days_mask & ?) != 0 \
         ORDER BY r.time_hhmm ASC",
    )
    .bind(user_id)
    .bind(today_bit)
    .fetch_all(&state.db)
    .await?;

    if rows.is_empty() {
        return Ok(());
    }
    let tts_enabled = get_bool_setting(state, user_id, "notifications.tts_enabled", false).await?;
    let epoch_day = now.date_naive().num_days_from_ce() as i64;

    for row in &rows {
        let routine_id: i64 = row.get("id");
        let goal_id: i64 = row.get("goal_id");
        let time_hhmm: String = row.get("time_hhmm");
        let days_mask: i64 = row.get("days_mask");
        let title: String = row.get("title");

        if pure::due_state(
            now_naive,
            today_bit,
            days_mask,
            &time_hhmm,
            pure::ROUTINE_GRACE_MIN,
        ) != pure::DueState::Due
        {
            continue;
        }

        // 클레임 먼저. LLM 호출로 1~3초 공백이 생기므로 "확인 후 기록" 2단계는 중복 발화 위험.
        let claimed = sqlx::query(
            "INSERT OR IGNORE INTO routine_notifications_sent (user_id, routine_id, date, sent_at) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(routine_id)
        .bind(&today_date)
        .bind(Utc::now().to_rfc3339())
        .execute(&state.db)
        .await?;
        if claimed.rows_affected() == 0 {
            continue; // 오늘 이미 보냄
        }

        let texts: Vec<String> = load_whys(state, user_id, goal_id)
            .await?
            .into_iter()
            .map(|w| w.text)
            .collect();
        let why = pure::pick_why(&texts, epoch_day);
        // compose는 절대 실패하지 않는다 — 폴백으로 흡수하고 반드시 발화한다.
        let (message, generated) = notify::compose(state, user_id, &title, why, now).await;

        state.emit(
            "routine.fired",
            json!({
                "user_id": user_id,
                "routine_id": routine_id,
                "goal_id": goal_id,
                "goal_title": title,
                "message": message,
                "why": why,
                "generated": generated,
                "tts_enabled": tts_enabled,
                "scheduled_at": format!("{} {}", today_date, time_hhmm),
            }),
        );
        tracing::info!(user_id, routine_id, generated, "routine nudge fired");
    }
    Ok(())
}

/// settings 읽기 공용 헬퍼가 없는 게 현재 관례라 모듈별 사본을 둔다
/// (`notifications/mod.rs`, `schedule/mod.rs`, `travel/mod.rs`에도 각자 있음).
async fn get_bool_setting(
    state: &AppState,
    user_id: i64,
    key: &str,
    default: bool,
) -> AppResult<bool> {
    let v: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind(key)
            .fetch_optional(&state.db)
            .await?
            .flatten();
    Ok(match v.as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => default,
    })
}
