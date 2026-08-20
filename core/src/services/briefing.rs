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
    /// 오늘 해당하는 목표 루틴 줄. `briefings` 캐시에 저장하지 않고 **반환 지점마다 재계산**한다
    /// — 아침에 목표를 추가한 게 즉시 반영되고 스키마 변경도 필요 없다.
    pub goal_lines: Vec<String>,
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
    let Some(r) = row else {
        return Ok(None);
    };
    // 목표 조회 실패가 브리핑 자체를 막으면 안 된다.
    let goal_lines = crate::services::goals::briefing_lines(state, user_id)
        .await
        .unwrap_or_default();
    Ok(Some(Briefing {
        date: r.get("date"),
        summary: r.get("summary"),
        event_count: 0,
        todo_count: 0,
        created_at: r.get("created_at"),
        goal_lines,
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

    let goal_lines = crate::services::goals::briefing_lines(state, user_id)
        .await
        .unwrap_or_default();

    Ok(Briefing {
        date: today,
        summary,
        event_count: events.len(),
        todo_count: todos.len(),
        created_at: now,
        goal_lines,
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

    // 위 일정/할 일은 **맥락**일 뿐 출력 대상이 아니다. 목록은 채팅 카드와 할 일 탭이 이미
    // 보여주므로, 여기서는 "오늘 뭘 해내면 되는지"를 짚어 밀어주는 한마디만 만든다.
    user_text.push_str(
        "\n위 정보는 참고용 맥락이에요. 목록을 나열하거나 요약하지 마세요. \
         대신 오늘 사용자가 목표에 한 걸음 다가가도록 밀어주는 한두 문장을 써 주세요. \
         규칙: ① '안녕하세요' 같은 인사말로 시작하지 않아요. \
         ② 오늘 가장 중요한 것 하나만 고릅니다 — 마감이 임박했거나 우선순위가 높은 할 일, \
         그것도 없으면 첫 일정. 그 하나를 짚고 해내는 데 도움이 될 구체적인 한마디를 붙여요 \
         (예: 어디부터 손대면 좋을지, 얼마나 남았는지). \
         ③ 뻔한 명언·격언 인용은 쓰지 않아요. 오늘의 실제 내용에 붙은 말이어야 해요. \
         ④ 일정도 할 일도 없으면 가볍게 하루를 여는 한 문장만. \
         ⑤ 두 문장을 넘기지 않고, 이모지는 최대 1개, 목록·마크다운은 쓰지 않아요.",
    );

    let system = ChatMessage {
        role: Role::System,
        content: Some(
            "당신은 사용자의 1인용 데스크톱 비서입니다. 하루를 여는 짧은 한마디를 건넵니다. \
             나열·요약이 아니라, 오늘 무엇을 해내면 되는지 짚어 주고 등을 밀어 주는 역할이에요. \
             과장된 응원이나 오글거리는 표현은 피하고 담백하고 다정하게. \
             말투는 해요체로 통일합니다 — 모든 문장을 '~해요/~예요/~드릴게요'로 끝내고, \
             반말과 합쇼체(~습니다)는 쓰지 않으며 한 답변 안에서 말투를 섞지 않습니다."
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
