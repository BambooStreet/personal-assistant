use chrono::{DateTime, Local, Timelike, Utc};
use serde::Serialize;
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::services::calendar::sync;
// 시간대 구분의 정의는 인사 쪽에 있다 — 브리핑이 아침 전용이 되면서 이 구분을
// 실제로 가르는 쪽이 인사가 됐다(D-025).
use crate::services::greeting::pure::{time_slot, TimeSlot};
use crate::services::llm::cost::estimate_chat_cost_usd;
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

    // 인사에 이름을 부르기 위해 필요. 미설정이면 이름 없이 인사한다.
    let user_name = crate::commands::chat::read_user_name(&state.db, user_id)
        .await
        .unwrap_or(None);

    let summary =
        generate_summary(state, user_id, &today, &events, &todos, user_name.as_deref()).await?;
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
        "INSERT INTO messages (user_id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts, source) \
         VALUES (?, 'default', 'assistant', ?, NULL, NULL, NULL, ?, 'briefing')",
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

pub(crate) fn fmt_utc_z(dt: chrono::DateTime<chrono::Utc>) -> String {
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
    user_name: Option<&str>,
) -> AppResult<String> {
    let now_local = Local::now();
    let slot = time_slot(now_local.hour());
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
    user_text.push_str(&format!(
        "오늘은 {today_local} {weekday}이고, 지금은 {time} ({slot})입니다.\n",
        time = now_local.format("%H:%M"),
        slot = slot.label(),
    ));
    if let Some(name) = user_name {
        user_text.push_str(&format!("사용자 이름: {name}님\n"));
    }
    user_text.push('\n');

    if events.is_empty() {
        user_text.push_str("📅 오늘 일정: 없음\n");
    } else {
        user_text.push_str("📅 오늘 일정:\n");
        for ev in events {
            // 오후·밤에 처음 켜면 이미 끝난 일정도 목록에 들어온다(쿼리가 하루 전체를 본다).
            // 지난 것을 표시해 줘야 LLM이 끝난 일정을 "앞두고 있어요"라고 짚지 않는다.
            let past = !ev.all_day && event_is_past(&ev.end_at, now_local);
            user_text.push_str(&format!(
                "- {} {}{}{}\n",
                format_event_time(&ev.start_at, &ev.end_at, ev.all_day),
                ev.summary,
                ev.location
                    .as_ref()
                    .map(|l| format!(" @ {l}"))
                    .unwrap_or_default(),
                if past { " (이미 지남)" } else { "" }
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
    // 보여주므로, 여기서는 "지금 뭘 해내면 되는지"를 짚어 밀어주는 한마디만 만든다.
    //
    // 인사는 여기서 하지 않는다 — 부팅 시 인사는 `services::greeting`이 먼저 건네고
    // 브리핑이 그 뒤를 잇는다. 둘 다 인사하면 "좋은 아침이에요"가 두 번 나온다(D-025).
    user_text.push_str(&format!(
        "\n위 정보는 참고용 맥락이에요. 목록을 나열하거나 요약하지 마세요. \
         이건 아침에 컴퓨터를 켠 사용자에게 비서가 건네는 오늘의 한마디예요. \
         사용자가 한 걸음 나아가도록 밀어주세요.\n\
         지금은 {slot}이고, 하루를 여는 결로 씁니다.\n\
         규칙: ① 인사는 이미 건넸어요 — '좋은 아침이에요' 같은 인사말이나 자기소개 없이 \
         바로 본론부터 시작해요. 이름은 필요하면 한 번만 불러요. \
         ② 지금 가장 중요한 것 하나만 고릅니다 — 마감이 임박했거나 우선순위가 높은 \
         할 일, 그것도 없으면 아직 남은 일정. 그 하나를 짚고 해내는 데 도움이 될 구체적인 \
         한마디를 붙여요 (예: 어디부터 손대면 좋을지, 얼마나 남았는지). \
         ③ '(이미 지남)'으로 표시된 일정은 앞둔 일처럼 말하지 않아요 — 언급한다면 \
         지나간 일로만 다뤄요. \
         ④ 뻔한 명언·격언 인용은 쓰지 않아요. 오늘의 실제 내용에 붙은 말이어야 해요. \
         ⑤ 일정도 할 일도 없으면 가벼운 한마디로만 끝내요. \
         ⑥ 두 문장을 넘기지 않고, 이모지는 최대 1개, 목록·마크다운은 쓰지 않아요.",
        slot = slot.label(),
    ));

    let system = ChatMessage {
        role: Role::System,
        content: Some(
            "당신은 사용자의 1인용 데스크톱 비서입니다. 인사는 이미 건넸고, \
             이어서 오늘의 짧은 한마디를 건넵니다. \
             나열·요약이 아니라, 지금 무엇을 해내면 되는지 짚어 주고 등을 밀어 주는 역할이에요. \
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
        // 인사가 매일 같은 문장이면 금세 벽지가 된다 — 루틴 알림(0.8)과 같은 이유로 올렸다.
        temperature: Some(0.7),
    };

    let resp = state.llm.chat(&state.secrets, req).await?;
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

/// 이 일정이 이미 끝났는지. 파싱 실패는 "안 지남"으로 — 애매하면 지운 것처럼 다루지 않는다.
fn event_is_past(end_at: &str, now: DateTime<Local>) -> bool {
    chrono::DateTime::parse_from_rfc3339(end_at)
        .map(|d| d.with_timezone(&Local) < now)
        .unwrap_or(false)
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn 지난_일정_판정() {
        let now = Local.with_ymd_and_hms(2026, 8, 25, 15, 0, 0).unwrap();
        let ended = (now - chrono::Duration::hours(2)).to_rfc3339();
        let later = (now + chrono::Duration::hours(2)).to_rfc3339();
        assert!(event_is_past(&ended, now));
        assert!(!event_is_past(&later, now));
        // 파싱 실패는 "안 지남" — 애매한 걸 끝난 일로 단정하지 않는다.
        assert!(!event_is_past("깨진 값", now));
    }
}
