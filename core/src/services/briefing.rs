use chrono::{Local, Utc};
use serde::Serialize;
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::services::calendar::sync;
use crate::services::llm::cost::estimate_chat_cost_usd;
use crate::services::llm::openai::OpenAiAdapter;
use crate::services::llm::{ChatMessage, ChatRequest, Role};
use crate::state::AppState;

const MODEL: &str = "gpt-4o-mini";

#[derive(Debug, Serialize, Clone)]
pub struct Briefing {
    pub date: String,
    pub summary: String,
    pub event_count: usize,
    pub todo_count: usize,
    pub created_at: String,
}

pub async fn get_today(state: &AppState, user_id: i64) -> AppResult<Option<Briefing>> {
    let today = today_local_date();
    let row = sqlx::query(
        "SELECT date, summary, created_at FROM briefings WHERE user_id = ? AND date = ?",
    )
    .bind(user_id)
    .bind(&today)
    .fetch_optional(&state.db)
    .await?;
    Ok(row.map(|r| Briefing {
        date: r.get("date"),
        summary: r.get("summary"),
        event_count: 0,
        todo_count: 0,
        created_at: r.get("created_at"),
    }))
}

pub async fn run_for_today(state: &AppState, user_id: i64, force: bool) -> AppResult<Briefing> {
    let today = today_local_date();

    if !force {
        if let Some(existing) = get_today(state, user_id).await? {
            return Ok(existing);
        }
    }

    if !state.secrets.has(crate::infra::secrets::SecretKey::OpenAiApiKey)? {
        return Err(AppError::Unauthorized("OpenAI 키가 설정되지 않았습니다".into()));
    }

    // Best-effort calendar sync (실패해도 계속 진행)
    if let Err(e) = sync::run_sync(state, user_id).await {
        tracing::warn!("briefing 전 sync 실패 (무시하고 진행): {e}");
    }

    let events = load_today_events(state, user_id).await?;
    let todos = load_open_todos(state, user_id).await?;

    let summary = generate_summary(state, user_id, &today, &events, &todos).await?;
    let now = Utc::now().to_rfc3339();

    if force {
        sqlx::query(
            "INSERT INTO briefings (user_id, date, summary, audio_path, created_at) \
             VALUES (?, ?, ?, NULL, ?) \
             ON CONFLICT(user_id, date) DO UPDATE SET summary = excluded.summary, created_at = excluded.created_at",
        )
        .bind(user_id)
        .bind(&today)
        .bind(&summary)
        .bind(&now)
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query(
            "INSERT OR IGNORE INTO briefings (user_id, date, summary, audio_path, created_at) VALUES (?, ?, ?, NULL, ?)"
        )
        .bind(user_id)
        .bind(&today)
        .bind(&summary)
        .bind(&now)
        .execute(&state.db)
        .await?;
    }

    sqlx::query(
        "INSERT INTO messages (user_id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts) \
         VALUES (?, 'default', 'assistant', ?, NULL, NULL, NULL, ?)",
    )
    .bind(user_id)
    .bind(&summary)
    .bind(&now)
    .execute(&state.db)
    .await?;

    Ok(Briefing {
        date: today,
        summary,
        event_count: events.len(),
        todo_count: todos.len(),
        created_at: now,
    })
}

fn today_local_date() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn fmt_utc_z(dt: chrono::DateTime<chrono::Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[derive(Debug)]
struct EventBrief {
    summary: String,
    start_at: String,
    end_at: String,
    all_day: bool,
    location: Option<String>,
}

#[derive(Debug)]
struct TodoBrief {
    title: String,
    due_at: Option<String>,
    priority: i64,
}

async fn load_today_events(state: &AppState, user_id: i64) -> AppResult<Vec<EventBrief>> {
    let now = Local::now();
    let day_start = fmt_utc_z(
        now.date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(now.timezone())
            .unwrap()
            .to_utc(),
    );
    let day_end = fmt_utc_z(
        now.date_naive()
            .and_hms_opt(23, 59, 59)
            .unwrap()
            .and_local_timezone(now.timezone())
            .unwrap()
            .to_utc(),
    );

    let rows = sqlx::query(
        "SELECT summary, start_at, end_at, all_day, location FROM events \
         WHERE user_id = ? AND status != 'cancelled' AND end_at > ? AND start_at <= ? \
         ORDER BY start_at ASC",
    )
    .bind(user_id)
    .bind(&day_start)
    .bind(&day_end)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .iter()
        .map(|r| EventBrief {
            summary: r.get("summary"),
            start_at: r.get("start_at"),
            end_at: r.get("end_at"),
            all_day: r.get::<i64, _>("all_day") != 0,
            location: r.get("location"),
        })
        .collect())
}

async fn load_open_todos(state: &AppState, user_id: i64) -> AppResult<Vec<TodoBrief>> {
    let rows = sqlx::query(
        "SELECT title, due_at, priority FROM todos WHERE user_id = ? AND done = 0 \
         ORDER BY COALESCE(due_at, '9999') ASC, priority DESC LIMIT 20",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| TodoBrief {
            title: r.get("title"),
            due_at: r.get("due_at"),
            priority: r.get("priority"),
        })
        .collect())
}

async fn generate_summary(
    state: &AppState,
    user_id: i64,
    today_local: &str,
    events: &[EventBrief],
    todos: &[TodoBrief],
) -> AppResult<String> {
    let now_local = Local::now();
    let weekday = match now_local.format("%w").to_string().as_str() {
        "0" => "일요일",
        "1" => "월요일",
        "2" => "화요일",
        "3" => "수요일",
        "4" => "목요일",
        "5" => "금요일",
        "6" => "토요일",
        _ => "",
    };

    let mut user_text = String::new();
    user_text.push_str(&format!("오늘은 {today_local} {weekday}입니다.\n\n"));

    if events.is_empty() {
        user_text.push_str("📅 오늘 일정: 없음\n");
    } else {
        user_text.push_str("📅 오늘 일정:\n");
        for ev in events {
            user_text.push_str(&format!(
                "- {} {}{}{}\n",
                format_event_time(&ev.start_at, &ev.end_at, ev.all_day),
                ev.summary,
                ev.location
                    .as_ref()
                    .map(|l| format!(" @ {l}"))
                    .unwrap_or_default(),
                ""
            ));
        }
    }
    user_text.push('\n');

    if todos.is_empty() {
        user_text.push_str("✅ 미완료 할 일: 없음\n");
    } else {
        user_text.push_str("✅ 미완료 할 일:\n");
        for t in todos {
            let prio_mark = if t.priority >= 2 { " ⚡" } else { "" };
            let due = t
                .due_at
                .as_ref()
                .map(|d| format!(" ({d})"))
                .unwrap_or_default();
            user_text.push_str(&format!("- {}{}{}\n", t.title, due, prio_mark));
        }
    }

    user_text.push_str(
        "\n위 내용을 짧고 자연스러운 한국어로 요약해 주세요. \
         인사로 시작해 2~3문장 이내로, 핵심만. \
         이모지는 1개 정도만 가볍게. 마크다운 헤더는 사용하지 마세요.",
    );

    let system = ChatMessage {
        role: Role::System,
        content: Some(
            "당신은 사용자의 1인용 데스크톱 비서입니다. 아침 브리핑을 친근하고 \
             간결하게 전달합니다."
                .into(),
        ),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    };
    let user = ChatMessage {
        role: Role::User,
        content: Some(user_text),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    };

    let req = ChatRequest {
        model: MODEL.to_string(),
        messages: vec![system, user],
        tools: vec![],
        temperature: Some(0.5),
    };

    let adapter = OpenAiAdapter::new(state.http.clone());
    let resp = adapter.chat_with_secrets(&state.secrets, req).await?;
    let text = resp
        .message
        .content
        .clone()
        .unwrap_or_else(|| "(빈 응답)".into());

    let cost =
        estimate_chat_cost_usd(&resp.model, resp.usage.input_tokens, resp.usage.output_tokens);
    let ts = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO cost_ledger (user_id, ts, provider, kind, model, input_tokens, output_tokens, cost_usd) \
         VALUES (?, ?, 'openai', 'briefing', ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(&ts)
    .bind(&resp.model)
    .bind(resp.usage.input_tokens as i64)
    .bind(resp.usage.output_tokens as i64)
    .bind(cost)
    .execute(&state.db)
    .await;

    Ok(text)
}

fn format_event_time(start_at: &str, end_at: &str, all_day: bool) -> String {
    if all_day {
        return "(종일)".into();
    }
    let start_t = chrono::DateTime::parse_from_rfc3339(start_at)
        .map(|d| d.with_timezone(&Local).format("%H:%M").to_string())
        .unwrap_or_else(|_| start_at.into());
    let end_t = chrono::DateTime::parse_from_rfc3339(end_at)
        .map(|d| d.with_timezone(&Local).format("%H:%M").to_string())
        .unwrap_or_else(|_| end_at.into());
    format!("{start_t}–{end_t}")
}
