//! 앱을 켤 때마다 건네는 인사. 브리핑과 달리 **하루 한 번이 아니다**(D-025).
//!
//! - 트리거: 앱 프로세스 시작. 쿨다운([`pure::COOLDOWN_HOURS`]) 안이면 조용히 넘어간다.
//! - 문구: LLM 한 번, 실패하면 결정론적 폴백으로 **반드시** 인사한다
//!   (`goals::notify`와 같은 원칙 — 밋밋한 인사 > 침묵).
//! - **인사는 인사만 한다.** 할 일·일정을 프롬프트에 아예 싣지 않는다 — 실으면 LLM이
//!   반드시 짚는다(브리핑 프롬프트가 그 증거).
//! - 모닝 브리핑은 아침 창 안에서 켰을 때만 곁들인다. 창 판정은 여기에만 있다 —
//!   `briefing::run_for_today`에 넣으면 카드의 "다시 생성"이 오후에 죽는다.

pub mod pure;
#[cfg(test)]
mod tests;

use chrono::{DateTime, Datelike, Local, Timelike, Utc};
use serde::Serialize;

use crate::error::AppResult;
use crate::infra::secrets::SecretKey;
use crate::services::briefing::{self, fmt_utc_z, Briefing};
use crate::services::llm::cost::estimate_chat_cost_usd;
use crate::services::llm::{ChatMessage, ChatRequest, Role};
use crate::state::AppState;

use pure::{Reunion, TimeSlot};

const MODEL: &str = "gpt-4o-mini";

/// 루틴 알림(0.8)과 같다 — 켤 때마다 나오는 문장이라 반복되면 금세 벽지가 된다.
const TEMPERATURE: f32 = 0.8;

/// 쿨다운 판정의 기준선. **allowlist에 없는 내부 키**라 `settings.set`으로는 못 건드린다
/// (`daily_cost_cap_usd`와 같은 취급). UI가 쿨다운을 임의로 리셋하면 안 되기 때문.
const LAST_GREETED_KEY: &str = "greeting.last_greeted_at";

const WINDOW_START_KEY: &str = "briefing.window_start";
const WINDOW_END_KEY: &str = "briefing.window_end";

#[derive(Debug, Serialize)]
pub struct GreetingOutcome {
    /// 이번 호출에서 인사가 실제로 나갔는가. 쿨다운에 걸리면 false.
    pub greeted: bool,
    pub text: Option<String>,
    /// LLM이 돌았는가. false면 폴백 문구.
    pub generated: bool,
    /// "first" | "again" | "overnight" | "few_days" | "long_time".
    pub reunion: String,
    /// 아침 창 밖이면 None.
    pub briefing: Option<Briefing>,
    /// 이번 호출에서 새로 만들어졌는가(= 자동 재생 대상).
    pub briefing_created: bool,
}

impl GreetingOutcome {
    fn skipped() -> Self {
        Self {
            greeted: false,
            text: None,
            generated: false,
            reunion: "cooldown".into(),
            briefing: None,
            briefing_created: false,
        }
    }
}

pub async fn run(state: &AppState, user_id: i64, force: bool) -> AppResult<GreetingOutcome> {
    let now = Local::now();

    // ⚠️ 클레임보다 **먼저** 읽어야 한다 — 클레임이 이 값을 덮어쓴다.
    let prev = last_interaction_at(state, user_id).await.unwrap_or(None);

    if !force && !claim(state, user_id, now).await? {
        return Ok(GreetingOutcome::skipped());
    }
    if force {
        // force 경로도 기준선은 갱신해 둔다(다음 부팅이 "방금 봤다"를 알도록).
        let _ = write_last_greeted(state, user_id, now).await;
    }

    let name = crate::commands::chat::read_user_name(&state.db, user_id)
        .await
        .unwrap_or(None);

    let reunion = pure::classify_gap(prev.map(|p| p.naive_local()), now.naive_local());
    let slot = pure::time_slot(now.hour());

    let (text, generated) = compose(state, user_id, name.as_deref(), reunion, slot, now).await;

    record_message(state, user_id, &text, now).await;

    let (brief, briefing_created) = maybe_briefing(state, user_id, now).await;

    state.emit(
        "greeting.fired",
        serde_json::json!({ "user_id": user_id, "text": text }),
    );

    Ok(GreetingOutcome {
        greeted: true,
        text: Some(text),
        generated,
        reunion: reunion.tag().into(),
        briefing: brief,
        briefing_created,
    })
}

/// 쿨다운을 원자적으로 선점한다. `true`면 이번 호출이 인사할 차례.
///
/// 아바타/패널 두 윈도우가 동시에 부팅하거나 HMR로 렌더러 가드가 뚫려도 여기서 잡힌다
/// — 이게 "인사 한 번"의 **최종 방어선**이다(`routine_notifications_sent`의 클레임과 같은 결).
async fn claim(state: &AppState, user_id: i64, now: DateTime<Local>) -> AppResult<bool> {
    let now_s = fmt_utc_z(now.to_utc());
    let cutoff = fmt_utc_z(now.to_utc() - chrono::Duration::hours(pure::COOLDOWN_HOURS));

    let res = sqlx::query(
        "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) \
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at \
         WHERE settings.value < ?",
    )
    .bind(user_id)
    .bind(LAST_GREETED_KEY)
    .bind(&now_s)
    .bind(&now_s)
    .bind(&cutoff)
    .execute(&state.db)
    .await?;

    Ok(res.rows_affected() == 1)
}

async fn write_last_greeted(state: &AppState, user_id: i64, now: DateTime<Local>) -> AppResult<()> {
    let now_s = fmt_utc_z(now.to_utc());
    sqlx::query(
        "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) \
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(user_id)
    .bind(LAST_GREETED_KEY)
    .bind(&now_s)
    .bind(&now_s)
    .execute(&state.db)
    .await?;
    Ok(())
}

/// "며칠 만인가"의 기준선 — 마지막 인사와 마지막 사용자 발화 중 **나중 것**.
///
/// 인사 시각만 보면 앱을 며칠간 켜 둔 채 매일 대화한 사람이 재부팅할 때 "3일 만이네요"가
/// 나온다. `messages.role='user'`의 마지막 ts는 이미 DB에 있는 공짜 상호작용 신호다.
async fn last_interaction_at(
    state: &AppState,
    user_id: i64,
) -> AppResult<Option<DateTime<Local>>> {
    let greeted: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind(LAST_GREETED_KEY)
            .fetch_optional(&state.db)
            .await?
            .flatten();

    let spoke: Option<String> =
        sqlx::query_scalar("SELECT MAX(ts) FROM messages WHERE user_id = ? AND role = 'user'")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?
            .flatten();

    Ok([greeted, spoke]
        .into_iter()
        .flatten()
        .filter_map(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.with_timezone(&Local))
        .max())
}

/// 인사 문구를 만든다. **절대 Err를 반환하지 않는다** — 어떤 실패든 폴백으로 흡수한다.
async fn compose(
    state: &AppState,
    user_id: i64,
    name: Option<&str>,
    reunion: Reunion,
    slot: TimeSlot,
    now: DateTime<Local>,
) -> (String, bool) {
    let seed = now.date_naive().num_days_from_ce() as i64;
    let fallback = pure::fallback_greeting(reunion, slot, name, seed);

    match state.secrets.has(SecretKey::OpenAiApiKey) {
        Ok(true) => {}
        Ok(false) => {
            // 키 없는 로컬 사용자는 정상 상태 — warn이 아니라 info.
            tracing::info!(user_id, "greeting: OpenAI 키 없음 → 폴백 문구");
            return (fallback, false);
        }
        Err(e) => {
            tracing::warn!(user_id, error = %e, "greeting: 키 조회 실패 → 폴백 문구");
            return (fallback, false);
        }
    }

    match generate(state, user_id, name, reunion, slot).await {
        Ok(text) if !text.trim().is_empty() => (text.trim().to_string(), true),
        Ok(_) => {
            tracing::warn!(user_id, "greeting: LLM 빈 응답 → 폴백 문구");
            (fallback, false)
        }
        Err(e) => {
            tracing::warn!(user_id, error = %e, "greeting: LLM 실패 → 폴백 문구");
            (fallback, false)
        }
    }
}

async fn generate(
    state: &AppState,
    user_id: i64,
    name: Option<&str>,
    reunion: Reunion,
    slot: TimeSlot,
) -> AppResult<String> {
    let mut ctx = String::new();
    ctx.push_str(&format!("지금은 {}이에요.\n", slot.label()));
    if let Some(n) = name {
        ctx.push_str(&format!("사용자 이름: {n}님\n"));
    }
    match reunion {
        Reunion::FewDays(d) | Reunion::LongTime(d) => {
            ctx.push_str(&format!("마지막으로 만난 지 {d}일 됐어요.\n"));
        }
        _ => {}
    }
    ctx.push_str(&format!("\n{}\n", pure::reunion_framing(reunion)));
    ctx.push_str(
        "\n사용자가 방금 컴퓨터를 켰어요. 반갑게 건네는 인사 한마디를 써 주세요.\n\
         규칙: ① 한두 문장, 짧게. \
         ② **인사만 해요.** 할 일·일정·목표를 언급하지 않고, 무엇을 하라고 밀지 않아요 \
         — 오늘 뭐 할 건지, 뭐 했는지 가볍게 물어보는 정도는 좋아요. \
         ③ 이름이 주어졌으면 자연스럽게 한 번만 불러요. \
         ④ '반갑습니다' 같은 딱딱한 인사나 뻔한 명언은 쓰지 않아요. \
         ⑤ 이모지는 최대 1개, 목록·마크다운은 쓰지 않아요.",
    );

    let system = ChatMessage {
        role: Role::System,
        content: Some(
            "당신은 사용자의 1인용 데스크톱 비서입니다. 사용자가 컴퓨터를 켜면 \
             반갑게 인사를 건넵니다. 용건을 꺼내거나 할 일을 챙겨 주는 자리가 아니라, \
             오랜만에 혹은 다시 만난 사람에게 건네는 인사말만 하는 자리예요. \
             과장된 응원이나 오글거리는 표현은 피하고 담백하고 다정하게. \
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

    let resp = state.llm.chat(&state.secrets, req).await?;
    let text = resp.message.content.clone().unwrap_or_default();

    let cost =
        estimate_chat_cost_usd(&resp.model, resp.usage.input_tokens, resp.usage.output_tokens);
    let ts = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO cost_ledger (user_id, ts, provider, kind, model, input_tokens, output_tokens, cost_usd) \
         VALUES (?, ?, 'openai', 'greeting', ?, ?, ?, ?)",
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

/// 채팅 기록에 남긴다(`source='greeting'`). 실패는 삼킨다 — 이미 나갈 인사를 되돌릴 수 없다.
async fn record_message(state: &AppState, user_id: i64, text: &str, now: DateTime<Local>) {
    let ts = now.to_utc().to_rfc3339();
    let res = sqlx::query(
        "INSERT INTO messages (user_id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts, source) \
         VALUES (?, 'default', 'assistant', ?, NULL, NULL, NULL, ?, 'greeting')",
    )
    .bind(user_id)
    .bind(text)
    .bind(&ts)
    .execute(&state.db)
    .await;
    if let Err(e) = res {
        tracing::warn!(user_id, error = %e, "greeting: 채팅 기록 저장 실패(무시)");
    }
}

/// 아침 창 안이면 오늘의 브리핑을 (없으면 만들어서) 돌려준다.
///
/// 브리핑 실패는 흡수한다 — 키가 없으면 `run_for_today`가 `Unauthorized`를 뱉는데,
/// 그것 때문에 인사까지 죽으면 안 된다.
async fn maybe_briefing(
    state: &AppState,
    user_id: i64,
    now: DateTime<Local>,
) -> (Option<Briefing>, bool) {
    let start = get_setting(state, user_id, WINDOW_START_KEY)
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| pure::DEFAULT_WINDOW_START.to_string());
    let end = get_setting(state, user_id, WINDOW_END_KEY)
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| pure::DEFAULT_WINDOW_END.to_string());

    if !pure::in_time_window(now.time(), &start, &end) {
        return (None, false);
    }

    // 이번 호출에서 새로 만들어졌는지 = 부르기 전에 캐시가 비어 있었는지.
    let existed = briefing::get_today(state, user_id)
        .await
        .unwrap_or(None)
        .is_some();

    match briefing::run_for_today(state, user_id, false).await {
        Ok(b) => (Some(b), !existed),
        Err(e) => {
            tracing::warn!(user_id, error = %e, "greeting: 브리핑 생성 실패(인사는 그대로 진행)");
            (None, false)
        }
    }
}

async fn get_setting(state: &AppState, user_id: i64, key: &str) -> AppResult<Option<String>> {
    let v: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind(key)
            .fetch_optional(&state.db)
            .await?
            .flatten();
    Ok(v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}
