//! 루틴 알림 문구 생성. LLM 한 번 호출하고, 실패하면 결정론적 폴백으로 **반드시** 발화한다.
//!
//! D-018(이동 알림)의 degrade 원칙과 방향이 반대인 게 의도적이다 — 이동 알림은
//! "거짓 발화 < 미발화"지만, 루틴 알림은 "밋밋한 문구 > 미발화"다. 사용자가 스스로 정한
//! 시각인데 아무것도 안 뜨면 루틴 자체를 놓친다.

use chrono::{DateTime, Datelike, Local, Utc, Weekday};

use crate::infra::secrets::SecretKey;
use crate::services::goals::pure;
use crate::services::llm::cost::estimate_chat_cost_usd;
use crate::services::llm::openai::OpenAiAdapter;
use crate::services::llm::{ChatMessage, ChatRequest, Role};
use crate::state::AppState;

const MODEL: &str = "gpt-4o-mini";

/// briefing(0.5)보다 높다 — 같은 루틴이 매일 같은 문장을 뱉으면 2주면 벽지가 된다.
const TEMPERATURE: f32 = 0.8;

/// 알림 문구를 만든다. 반환 `bool`은 "LLM이 실제로 돌았는가"(payload에 실어 사후 판정용).
///
/// 이 함수는 절대 Err를 반환하지 않는다. 어떤 실패든 폴백 문구로 흡수한다.
pub async fn compose(
    state: &AppState,
    user_id: i64,
    goal_title: &str,
    why: Option<&str>,
    now: DateTime<Local>,
) -> (String, bool) {
    let fallback = pure::fallback_message(goal_title, why);

    match state.secrets.has(SecretKey::OpenAiApiKey) {
        Ok(true) => {}
        Ok(false) => {
            // 키 없는 로컬 사용자는 정상 상태 — warn이 아니라 info.
            tracing::info!(user_id, "routine nudge: OpenAI 키 없음 → 폴백 문구");
            return (fallback, false);
        }
        Err(e) => {
            tracing::warn!(user_id, error = %e, "routine nudge: 키 조회 실패 → 폴백 문구");
            return (fallback, false);
        }
    }

    match generate(state, user_id, goal_title, why, now).await {
        Ok(text) if !text.trim().is_empty() => (text.trim().to_string(), true),
        Ok(_) => {
            tracing::warn!(user_id, "routine nudge: LLM 빈 응답 → 폴백 문구");
            (fallback, false)
        }
        Err(e) => {
            tracing::warn!(user_id, error = %e, "routine nudge: LLM 실패 → 폴백 문구");
            (fallback, false)
        }
    }
}

async fn generate(
    state: &AppState,
    user_id: i64,
    goal_title: &str,
    why: Option<&str>,
    now: DateTime<Local>,
) -> crate::error::AppResult<String> {
    let (total, remaining) = today_event_density(state, user_id, now).await.unwrap_or((0, 0));

    let mut ctx = String::new();
    ctx.push_str(&format!("목표: {goal_title}\n"));
    if let Some(w) = why {
        ctx.push_str(&format!("이 목표를 시작한 이유: {w}\n"));
    }
    ctx.push_str(&format!(
        "지금: {} {}요일 {}\n",
        now.format("%m월 %d일"),
        weekday_ko(now.weekday()),
        now.format("%H:%M")
    ));
    ctx.push_str(&format!(
        "오늘 일정: 총 {total}개, 지금 이후 남은 것 {remaining}개\n"
    ));
    ctx.push_str(
        "\n지금이 이 목표를 하기로 약속한 시각이에요. 등을 밀어주는 한마디를 써 주세요.\n\
         규칙: ① 한 문장, 40자 이내(길면 알림에서 잘려요). \
         ② '이유'가 있으면 그걸 자연스럽게 녹여요 — 그대로 따옴표로 옮기지 말고요. \
         ③ 오늘 일정이 많았으면 그걸 알아주는 말을 한 조각 섞어도 좋아요. \
         ④ 이모지·따옴표·마크다운은 쓰지 않아요. \
         ⑤ '하세요' 같은 명령조 대신 함께 하자는 결로. \
         ⑥ 뻔한 명언이나 격언은 쓰지 않아요.",
    );

    let system = ChatMessage {
        role: Role::System,
        content: Some(
            "당신은 사용자의 1인용 데스크톱 비서입니다. 사용자가 스스로 정한 시각에 \
             짧은 한마디를 건넵니다. 과장된 응원이나 오글거리는 표현은 피하고 담백하고 다정하게. \
             말투는 해요체로 통일합니다 — 문장을 '~해요/~예요'로 끝내고, \
             반말과 합쇼체(~습니다)는 쓰지 않습니다."
                .into(),
        ),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    };
    let user = ChatMessage {
        role: Role::User,
        content: Some(ctx),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    };

    let req = ChatRequest {
        model: MODEL.to_string(),
        messages: vec![system, user],
        tools: vec![],
        temperature: Some(TEMPERATURE),
    };

    let adapter = OpenAiAdapter::new(state.http.clone());
    let resp = adapter.chat_with_secrets(&state.secrets, req).await?;
    let text = resp.message.content.clone().unwrap_or_default();

    let cost =
        estimate_chat_cost_usd(&resp.model, resp.usage.input_tokens, resp.usage.output_tokens);
    let ts = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO cost_ledger (user_id, ts, provider, kind, model, input_tokens, output_tokens, cost_usd) \
         VALUES (?, ?, 'openai', 'routine_nudge', ?, ?, ?, ?)",
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

/// 오늘 시간 일정의 (총 개수, 지금 이후 남은 개수). 문구에 "오늘 빡셌죠" 같은 결을 주기 위한 입력.
async fn today_event_density(
    state: &AppState,
    user_id: i64,
    now: DateTime<Local>,
) -> crate::error::AppResult<(i64, i64)> {
    let day_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(now.timezone())
        .unwrap()
        .to_utc()
        .to_rfc3339();
    let day_end = now
        .date_naive()
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_local_timezone(now.timezone())
        .unwrap()
        .to_utc()
        .to_rfc3339();
    let now_utc = now.to_utc().to_rfc3339();

    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN start_at > ? THEN 1 ELSE 0 END), 0) \
         FROM events \
         WHERE user_id = ? AND status != 'cancelled' AND all_day = 0 \
           AND start_at >= ? AND start_at <= ?",
    )
    .bind(&now_utc)
    .bind(user_id)
    .bind(&day_start)
    .bind(&day_end)
    .fetch_one(&state.db)
    .await?;

    Ok(row)
}

fn weekday_ko(w: Weekday) -> &'static str {
    match w {
        Weekday::Mon => "월",
        Weekday::Tue => "화",
        Weekday::Wed => "수",
        Weekday::Thu => "목",
        Weekday::Fri => "금",
        Weekday::Sat => "토",
        Weekday::Sun => "일",
    }
}
