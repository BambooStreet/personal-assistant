use chrono::{Datelike, Local, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::services::llm::cost::estimate_chat_cost_usd;
use crate::services::llm::dispatch;
use crate::services::llm::openai::OpenAiAdapter;
use crate::services::llm::tools::default_toolset;
use crate::services::llm::{ChatMessage, ChatRequest, FinishReason, Role, ToolCall};
use crate::services::memory::{self, Memory};
use crate::state::AppState;

const DEFAULT_MODEL: &str = "gpt-5-mini";
const DEFAULT_CONVERSATION: &str = "default";
const HISTORY_TURN_CAP: i64 = 40;
const MAX_AGENT_ITERATIONS: u32 = 4;
// 사용자 마지막 메시지로 LIKE 검색해 관련된 메모리만 system prompt에 자동 주입.
// 매칭 0건이면 블록 자체를 생략 — 무관한 질문에 사용자 사실이 따라붙는 토큰 낭비를 피함.
const RELEVANT_MEMORIES_FOR_PROMPT: i64 = 3;

// 표시 지침(구조만, 톤 X). system 프롬프트가 아니라 해당 tool 결과에 동봉되어 그 tool이 실제
// 호출된 직후 iteration에만 모델에 노출된다 → 일상 대화 간섭/누적 없음. 어조는 코어 system
// 프롬프트가 단독 관할(여기서 톤을 새로 정하지 않음).
// 시각 규칙: tool 결과의 start_at/end_at은 UTC(RFC3339)라 반드시 사용자 타임존으로 변환해
// 'HH:MM'로만 표시하고 원본 타임스탬프를 노출하지 않는다 — 모든 일정 표시 지침에 인라인.
const BRIEFING_PRESENT_HINT: &str = "표시 지침: 이 결과를 '오늘 일정' 브리핑으로 제시한다. \
구조만 따르고 어조는 시스템 지침을 그대로 쓴다(여기서 톤을 새로 정하지 않음). \
시각 규칙: start_at/end_at은 UTC이므로 반드시 시스템 프롬프트의 사용자 타임존 오프셋으로 변환해 \
'HH:MM'(24시간제)로만 표시하고 '…T…Z' 원본 타임스탬프/오프셋을 절대 그대로 쓰지 않는다. \
구조: ① 일정을 시작 시각 순으로 '〈HH:MM–HH:MM〉 〈제목〉〈 @장소〉'로 나열(종일은 '(종일) 〈제목〉'). \
② 할 일(todos)이 있으면 일정 뒤에 '할 일' 섹션으로 묶어, 기한 빠른 순으로 각 항목을 \
'〈제목〉〈 · 기한(오늘이면 HH:MM, 다른 날이면 M/D)〉〈 (예상 N분)〉'로 나열한다(priority 2~3은 제목 앞 '★' 강조). \
todos의 due_at도 UTC이므로 위 시각 규칙대로 변환하고 우선순위 숫자는 노출하지 않는다. \
③ 마지막에 한 줄 요약. 빈 섹션은 생략.";

const UPCOMING_PRESENT_HINT: &str = "표시 지침: '다가오는 일정' 목록을 제시한다. 어조는 \
시스템 지침을 따른다. 시각 규칙: start_at/end_at은 UTC이므로 반드시 시스템 프롬프트의 사용자 \
타임존 오프셋으로 변환해 'HH:MM'(24시간제)로만 표시하고 '…T…Z' 원본 타임스탬프/오프셋을 절대 \
그대로 쓰지 않는다. 구조: ① 날짜별로 묶어 'M/D(요일)' 헤더를 두고, 그 아래 각 일정을 시작 \
시각 순으로 '〈HH:MM–HH:MM〉 〈제목〉〈 @장소〉'로 나열(종일은 '(종일) 〈제목〉'). ② 마지막에 \
'총 N건' 같은 한 줄 요약. 번호목록(1)2)3))이나 원본 타임스탬프 나열은 하지 않는다.";

const SCHEDULE_PRESENT_HINT: &str = "표시 지침: 이 결과로 '오늘 일과 추천'을 제시한다. 어조는 \
시스템 지침을 따른다. free_slots 안에서만 배치를 말하고(슬롯 밖/겹침 금지), proposed는 베이스라인이며 \
마감·중요도를 고려해 순서를 조정·설명해도 된다. 구조: ① 시간순으로 '〈HH:MM–HH:MM〉 〈할 일〉(예상 N분)'을 \
나열하고 각 항목에 배치 사유 한 줄(마감/중요도). ② unplaced 항목은 사유(소요시간 미입력/빈 시간 부족)와 함께 \
따로 안내. ③ 마지막에 한 줄 요약. 끝에 '이대로 캘린더에 넣어드릴까요?'로 확인을 받고, 수락하면 schedule_commit을 호출한다.";

const TODOS_PRESENT_HINT: &str = "표시 지침: 이 결과를 '할 일' 목록으로 깔끔하게 제시한다. \
구조만 따르고 어조는 시스템 지침을 그대로 쓴다(여기서 톤을 새로 정하지 않음). \
시각 규칙: due_at은 UTC이므로 반드시 시스템 프롬프트의 사용자 타임존 오프셋으로 변환하고, \
'…T…Z' 원본 타임스탬프를 절대 그대로 쓰지 않는다. 기한이 오늘이면 'HH:MM'(24시간제), 다른 날이면 \
'M/D(요일)'로 표시한다. 구조: ① 기한 있는 항목을 기한 빠른 순으로 먼저, 기한 없는 항목은 그 뒤에 \
나열한다. 각 항목은 '〈제목〉〈 · 기한〉〈 (예상 N분)〉〈 (매일/매주/매월 반복)〉' 형식. ② priority가 \
높은 항목(2~3)은 제목 앞에 '★'를 붙여 강조하되 우선순위 숫자 자체는 노출하지 않는다. ③ 기한이 이미 \
지난 항목은 끝에 '(지남)', 완료된 항목은 '(완료)'를 덧붙인다. ④ 마지막에 '총 N건' 같은 한 줄 요약. \
빈 필드·빈 섹션은 생략하고, 번호목록(1)2)3))이나 원본 타임스탬프는 쓰지 않는다.";

// tool_name → 표시 지침 매핑. 해당 tool 결과가 방금 생성됐을 때만 조립 시점에 1회 주입.
const PRESENT_HINTS: &[(&str, &str)] = &[
    ("list_today_overview", BRIEFING_PRESENT_HINT),
    ("list_today_events", BRIEFING_PRESENT_HINT),
    ("list_upcoming_events", UPCOMING_PRESENT_HINT),
    ("list_todos", TODOS_PRESENT_HINT),
    ("suggest_schedule", SCHEDULE_PRESENT_HINT),
];

fn hint_for_tool(name: &str) -> Option<&'static str> {
    PRESENT_HINTS.iter().find(|(n, _)| *n == name).map(|(_, h)| *h)
}

#[derive(Debug, Serialize)]
pub struct ChatTurn {
    pub assistant_text: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: FinishReason,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
}

#[derive(Debug, Deserialize)]
pub struct ChatSendArgs {
    pub user_message: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StoredMessage {
    pub id: i64,
    pub conversation_id: String,
    pub role: String,
    pub content: Option<String>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_calls_json: Option<String>,
    pub ts: String,
}

pub async fn chat_send(state: &AppState, user_id: i64, args: ChatSendArgs) -> AppResult<ChatTurn> {
    let user_text = args.user_message.trim().to_string();
    if user_text.is_empty() {
        return Err(AppError::InvalidInput("empty message".into()));
    }
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());

    enforce_daily_cap(&state.db, user_id).await?;

    // 이전 turn에서 도구 confirm을 안 하고 사용자가 새 메시지를 보낸 경우,
    // history에 orphan tool_call이 남아 OpenAI 프로토콜이 깨짐 → 합성 거부 메시지로 닫기.
    close_orphan_tool_calls(&state.db, user_id, &conv_id).await?;

    // 사용자 메시지 저장 후 agent loop 진입.
    let user_ts = Utc::now().to_rfc3339();
    persist_message(
        &state.db,
        user_id,
        &conv_id,
        "user",
        Some(&user_text),
        None,
        None,
        None,
        &user_ts,
    )
    .await?;

    run_agent_loop(state, user_id, &conv_id).await
}

/// 마지막 assistant 메시지가 tool_calls를 포함하지만 뒤따르는 tool 메시지가 없으면,
/// 합성 거부 메시지를 삽입해 OpenAI history 일관성 유지.
async fn close_orphan_tool_calls(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    conv_id: &str,
) -> AppResult<()> {
    let last = sqlx::query(
        "SELECT id, role, tool_calls_json FROM messages \
         WHERE user_id = ? AND conversation_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(user_id)
    .bind(conv_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = last else { return Ok(()) };
    let role: String = row.get("role");
    let tool_calls_json: Option<String> = row.get("tool_calls_json");

    if role != "assistant" {
        return Ok(());
    }
    let Some(json) = tool_calls_json else {
        return Ok(());
    };
    let calls: Vec<ToolCall> = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    for call in calls {
        let ts = Utc::now().to_rfc3339();
        persist_message(
            pool,
            user_id,
            conv_id,
            "tool",
            Some("{\"abandoned\":true,\"note\":\"사용자가 confirm 없이 새 메시지로 넘어갔습니다.\"}"),
            Some(&call.id),
            Some(&call.name),
            None,
            &ts,
        )
        .await?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ChatContinueArgs {
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub tool_call_id: String,
    pub tool_name: String,
    /// 사용자가 쓰기 도구 실행을 승인했는지. false = 거부.
    /// (4b) 클라이언트는 승인/거절만 보내고 실행은 Core가 한다.
    pub approved: bool,
}

/// UI/봇 confirm 결과를 받아 처리. 승인이면 Core가 쓰기 도구를 직접 실행하고(4b),
/// 결과(또는 거부/실패)를 tool 메시지로 history에 추가한 뒤 agent loop 재개.
pub async fn chat_continue(
    state: &AppState,
    user_id: i64,
    args: ChatContinueArgs,
) -> AppResult<ChatTurn> {
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());

    enforce_daily_cap(&state.db, user_id).await?;

    // 중복 승인 가드: 같은 tool_call_id가 이미 tool 결과로 닫혀 있으면 재실행 금지
    // (텔레그램 Yes 2회 탭 → 일정 2개 생성 방지). 조용히 종료.
    if tool_call_already_closed(&state.db, user_id, &conv_id, &args.tool_call_id).await? {
        return Ok(ChatTurn {
            assistant_text: None,
            tool_calls: vec![],
            finish_reason: FinishReason::Other,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
        });
    }

    let content = if !args.approved {
        "{\"rejected\":true,\"note\":\"사용자가 도구 실행을 거부했습니다.\"}".to_string()
    } else {
        // pending 쓰기 도구의 인자를 history(assistant tool_calls)에서 회수해 Core가 직접 실행.
        // 실패는 tool 결과 JSON으로 LLM에 전달 → 모델이 "실패했어요"를 자연어로 마무리(동작 변경).
        match find_pending_tool_call(&state.db, user_id, &conv_id, &args.tool_call_id).await? {
            Some(c) => match dispatch::execute_write_tool(state, user_id, &c.name, c.arguments).await
            {
                Ok(s) => s,
                Err(e) => serde_json::json!({ "error": e.to_string() }).to_string(),
            },
            None => serde_json::json!({
                "error": "승인 대상 도구 호출을 찾지 못했습니다(이미 처리되었거나 만료)."
            })
            .to_string(),
        }
    };

    let ts = Utc::now().to_rfc3339();
    persist_message(
        &state.db,
        user_id,
        &conv_id,
        "tool",
        Some(&content),
        Some(&args.tool_call_id),
        Some(&args.tool_name),
        None,
        &ts,
    )
    .await?;

    run_agent_loop(state, user_id, &conv_id).await
}

/// 같은 tool_call_id에 대한 tool 결과 메시지가 이미 존재하는지(= 이미 처리됨).
async fn tool_call_already_closed(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    conv_id: &str,
    tool_call_id: &str,
) -> AppResult<bool> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM messages \
         WHERE user_id = ? AND conversation_id = ? AND role = 'tool' AND tool_call_id = ? LIMIT 1",
    )
    .bind(user_id)
    .bind(conv_id)
    .bind(tool_call_id)
    .fetch_optional(pool)
    .await?;
    Ok(found.is_some())
}

/// 가장 최근 assistant 메시지의 tool_calls에서 tool_call_id와 일치하는 pending 호출을 회수.
async fn find_pending_tool_call(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    conv_id: &str,
    tool_call_id: &str,
) -> AppResult<Option<ToolCall>> {
    let json: Option<String> = sqlx::query_scalar(
        "SELECT tool_calls_json FROM messages \
         WHERE user_id = ? AND conversation_id = ? AND role = 'assistant' AND tool_calls_json IS NOT NULL \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(user_id)
    .bind(conv_id)
    .fetch_optional(pool)
    .await?
    .flatten();
    let Some(json) = json else {
        return Ok(None);
    };
    let calls: Vec<ToolCall> = serde_json::from_str(&json).unwrap_or_default();
    Ok(calls.into_iter().find(|c| c.id == tool_call_id))
}

async fn enforce_daily_cap(pool: &sqlx::SqlitePool, user_id: i64) -> AppResult<()> {
    let cap = crate::commands::settings::read_daily_cap_usd(pool, user_id).await?;
    let today = today_cost_usd(pool, user_id).await?;
    if today >= cap {
        return Err(AppError::Unauthorized(format!(
            "오늘 누적 LLM 비용 ${:.4}이 한도 ${:.2}를 초과했습니다. 설정에서 한도를 조정하세요.",
            today, cap
        )));
    }
    Ok(())
}

/// LLM 호출 → tool_call이 있으면 read-only는 자동 실행하고 다음 iteration,
/// write 도구는 pending으로 반환. 텍스트 응답이 나오면 종료.
async fn run_agent_loop(state: &AppState, user_id: i64, conv_id: &str) -> AppResult<ChatTurn> {
    let user_name = read_user_name(&state.db, user_id).await?;
    let adapter = OpenAiAdapter::new(state.http.clone());

    let mut total_input_tokens: u32 = 0;
    let mut total_output_tokens: u32 = 0;
    let mut total_cost: f64 = 0.0;
    let mut last_finish = FinishReason::Other;
    let mut last_text: Option<String> = None;

    for _ in 0..MAX_AGENT_ITERATIONS {
        // 매 iteration마다 history 다시 로드 (방금 저장한 tool/assistant 메시지 포함).
        let history = load_recent_messages(&state.db, user_id, conv_id, HISTORY_TURN_CAP).await?;
        // 사용자 마지막 메시지로 관련 메모리 검색 (자동 주입). 매칭 0건이면 빈 Vec.
        // 무관한 질문("지금 몇 시야?")에서는 자연스럽게 블록 생략 → 토큰 낭비 X.
        let last_user_query = history
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .and_then(|m| m.content.as_deref())
            .unwrap_or("");
        let relevant_memories = if last_user_query.trim().is_empty() {
            Vec::new()
        } else {
            memory::search_silent(&state.db, user_id, last_user_query, RELEVANT_MEMORIES_FOR_PROMPT)
                .await
                .unwrap_or_default()
        };
        let now_local = Local::now();
        let tz = now_local.offset().to_string();
        let system_prompt = build_system_prompt(
            &now_local.to_rfc3339(),
            &tz,
            user_name.as_deref(),
            &relevant_memories,
        );

        let mut messages: Vec<ChatMessage> = Vec::with_capacity(history.len() + 1);
        messages.push(ChatMessage {
            role: Role::System,
            content: Some(system_prompt),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        });
        // 표시 지침 대상 tool 결과가 방금(이번 턴에) 생성됐으면 그 한 건에만 지침을 덧입힌다.
        // DB에는 데이터만 저장하고 주입은 조립 시점에만 → history 누적/톤 누수 없음.
        let decorate = present_decorate_target(&history);
        for h in &history {
            if let Some(mut m) = stored_to_chat(h) {
                if let Some((id, hint)) = decorate {
                    if h.id == id {
                        m.content =
                            Some(decorate_with_hint(m.content.as_deref().unwrap_or(""), hint));
                    }
                }
                messages.push(m);
            }
        }

        let req = ChatRequest {
            model: DEFAULT_MODEL.to_string(),
            messages,
            tools: default_toolset(),
            // gpt-5-mini는 temperature 커스터마이즈 불가 (default=1만 허용). None이면
            // adapter가 필드를 통째로 생략해 OpenAI 기본값을 쓴다.
            temperature: None,
        };

        let resp = adapter.chat_with_secrets(&state.secrets, req).await?;

        total_input_tokens = total_input_tokens.saturating_add(resp.usage.input_tokens);
        total_output_tokens = total_output_tokens.saturating_add(resp.usage.output_tokens);
        let cost = estimate_chat_cost_usd(
            &resp.model,
            resp.usage.input_tokens,
            resp.usage.output_tokens,
        );
        total_cost += cost;
        record_cost(
            &state.db,
            user_id,
            &resp.model,
            resp.usage.input_tokens,
            resp.usage.output_tokens,
            cost,
        )
        .await?;

        last_finish = resp.finish_reason;
        let assistant_text = resp.message.content.clone();
        last_text = assistant_text.clone();
        let tool_calls_full = resp.message.tool_calls.clone().unwrap_or_default();

        // 응답의 tool_call들을 앞에서부터 훑어 prefix를 자른다:
        // - 앞쪽 read-only는 모두 prefix에 포함 (자동 실행 예정).
        // - 첫 write를 만나면 그것까지 포함하고 멈춤 (UI confirm 필요).
        // - prefix 뒤의 tool_call은 폐기 — 필요하면 LLM이 다음 턴에 재호출.
        let mut prefix: Vec<ToolCall> = Vec::with_capacity(tool_calls_full.len());
        for call in tool_calls_full.into_iter() {
            let is_write = !dispatch::is_read_only(&call.name);
            prefix.push(call);
            if is_write {
                break;
            }
        }

        // assistant 메시지 저장 (실제 실행할 prefix만 history에 보존).
        let assistant_ts = Utc::now().to_rfc3339();
        let tool_calls_json = if prefix.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&prefix).unwrap_or_default())
        };
        let tool_name_for_db = prefix.first().map(|c| c.name.clone());

        persist_message(
            &state.db,
            user_id,
            conv_id,
            "assistant",
            assistant_text.as_deref(),
            None,
            tool_name_for_db.as_deref(),
            tool_calls_json.as_deref(),
            &assistant_ts,
        )
        .await?;

        if prefix.is_empty() {
            // tool_call 없음 → 텍스트 응답으로 종료.
            return Ok(ChatTurn {
                assistant_text,
                tool_calls: vec![],
                finish_reason: last_finish,
                input_tokens: total_input_tokens,
                output_tokens: total_output_tokens,
                cost_usd: total_cost,
            });
        }

        // prefix 순회: read-only는 자동 실행하고, write 만나면 pending 반환.
        for call in prefix.into_iter() {
            if dispatch::is_read_only(&call.name) {
                let result = match dispatch::execute_tool(
                    state,
                    user_id,
                    &call.name,
                    call.arguments.clone(),
                )
                .await
                {
                    Ok(s) => s,
                    Err(e) => serde_json::json!({"error": e.to_string()}).to_string(),
                };
                let tool_ts = Utc::now().to_rfc3339();
                persist_message(
                    &state.db,
                    user_id,
                    conv_id,
                    "tool",
                    Some(&result),
                    Some(&call.id),
                    Some(&call.name),
                    None,
                    &tool_ts,
                )
                .await?;
            } else {
                // write 도구 → pending으로 반환. UI confirm 후 chat_continue로 이어짐.
                return Ok(ChatTurn {
                    assistant_text,
                    tool_calls: vec![call],
                    finish_reason: last_finish,
                    input_tokens: total_input_tokens,
                    output_tokens: total_output_tokens,
                    cost_usd: total_cost,
                });
            }
        }
        // prefix 전체가 read-only였음 → 다음 iteration.
    }

    // max_iterations 초과 — 마지막 텍스트라도 돌려주되, 없으면 안내.
    Ok(ChatTurn {
        assistant_text: last_text.or_else(|| Some("죄송해요, 처리 단계가 너무 길어졌어요.".into())),
        tool_calls: vec![],
        finish_reason: last_finish,
        input_tokens: total_input_tokens,
        output_tokens: total_output_tokens,
        cost_usd: total_cost,
    })
}

#[derive(Debug, Deserialize)]
pub struct ChatHistoryArgs {
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

pub async fn chat_history(
    state: &AppState,
    user_id: i64,
    args: ChatHistoryArgs,
) -> AppResult<Vec<StoredMessage>> {
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());
    let lim = args.limit.unwrap_or(200).clamp(1, 1000);

    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts \
         FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY id ASC LIMIT ?",
    )
    .bind(user_id)
    .bind(&conv_id)
    .bind(lim)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .iter()
        .map(|r| StoredMessage {
            id: r.get("id"),
            conversation_id: r.get("conversation_id"),
            role: r.get("role"),
            content: r.get("content"),
            tool_call_id: r.get("tool_call_id"),
            tool_name: r.get("tool_name"),
            tool_calls_json: r.get("tool_calls_json"),
            ts: r.get("ts"),
        })
        .collect())
}

#[derive(Debug, Deserialize)]
pub struct ChatClearArgs {
    #[serde(default)]
    pub conversation_id: Option<String>,
}

pub async fn chat_clear(state: &AppState, user_id: i64, args: ChatClearArgs) -> AppResult<u64> {
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());
    let res = sqlx::query("DELETE FROM messages WHERE user_id = ? AND conversation_id = ?")
        .bind(user_id)
        .bind(&conv_id)
        .execute(&state.db)
        .await?;
    Ok(res.rows_affected())
}

fn build_system_prompt(
    now_iso: &str,
    tz: &str,
    user_name: Option<&str>,
    recent_memories: &[Memory],
) -> String {
    let name_line = user_name
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(|n| format!("사용자 이름: {n}님 (호명할 때 사용)\n"))
        .unwrap_or_default();
    let memory_block = if recent_memories.is_empty() {
        String::new()
    } else {
        let mut s = String::from("\n이번 질문과 관련된 사용자 사실 (자동 주입):\n");
        for m in recent_memories {
            if m.tags.is_empty() {
                s.push_str(&format!("- {}\n", m.content));
            } else {
                s.push_str(&format!("- {} [tags: {}]\n", m.content, m.tags.join(", ")));
            }
        }
        s.push_str("더 깊이 필요하면 search_memory를 호출해 보강하세요.\n");
        s
    };
    format!(
        "당신은 사용자의 책상 위 데스크톱 위젯에 사는 1인용 개인 비서입니다.\n\
         현재 시각: {now}\n\
         사용자 타임존 오프셋: {tz}\n\
         {name_line}\
         \n\
         규칙:\n\
         - 한국어로 친근하고 간결하게 답합니다(보통 1~3문장). 단 일정·할 일을 \
         정리해 보여줄 때는 구조에 맞춰 더 길어져도 됩니다.\n\
         - 일정을 정리해 알릴 때는 차분하고 정돈된 비서 어조를 씁니다.\n\
         - 일정/할 일 관련 요청은 가능하면 적절한 tool을 호출해 처리합니다.\n\
         - \"할 일/todo/task\"는 list_todos 계열, \"일정/미팅/약속/캘린더\"는 \
         list_today_events·list_upcoming_events 계열을 사용합니다. 둘은 서로 다른 \
         데이터 소스이므로 혼동하지 마세요.\n\
         - 위 \"참고할 사용자 사실\" 블록의 내용은 이미 알고 있는 것으로 간주하고 \
         자연스럽게 활용합니다. 거기 없는 사실이 필요하면 search_memory를 호출하세요. \
         새로 알게 된 재사용 가치 있는 사실은 remember_fact로 저장하세요. 일회성 정보는 저장 X.\n\
         - 시간을 다룰 때는 위 사용자 타임존을 기준으로 ISO 8601 (offset 포함) 형식을 사용합니다.\n\
         - 캘린더 일정을 새로 만들거나 시간을 바꾸기 전에는 항상 해당 시간대의 기존 일정을 \
         먼저 조회해 시간이 겹치는지 확인합니다. 겹치는 일정이 있으면 곧바로 진행하지 말고 \
         무엇과 겹치는지 알린 뒤 그래도 진행할지 물어보고, 사용자가 거절하면 다른 시간을 \
         다시 묻습니다.\n\
         - 모호하면 임의로 가정하지 말고 짧게 한 번 더 묻습니다.\n\
         - 사용자가 명시적으로 요청하지 않은 추가 행동은 하지 않습니다.\
         {memory_block}",
        now = now_iso,
        tz = tz,
        name_line = name_line,
        memory_block = memory_block,
    )
}

async fn read_user_name(pool: &sqlx::SqlitePool, user_id: i64) -> AppResult<Option<String>> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind("user.name")
            .fetch_optional(pool)
            .await?
            .flatten();
    Ok(raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

async fn load_recent_messages(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    conv_id: &str,
    cap: i64,
) -> AppResult<Vec<StoredMessage>> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts \
         FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY id DESC LIMIT ?",
    )
    .bind(user_id)
    .bind(conv_id)
    .bind(cap)
    .fetch_all(pool)
    .await?;

    let mut out: Vec<StoredMessage> = rows
        .iter()
        .map(|r| StoredMessage {
            id: r.get("id"),
            conversation_id: r.get("conversation_id"),
            role: r.get("role"),
            content: r.get("content"),
            tool_call_id: r.get("tool_call_id"),
            tool_name: r.get("tool_name"),
            tool_calls_json: r.get("tool_calls_json"),
            ts: r.get("ts"),
        })
        .collect();
    out.reverse();
    Ok(out)
}

/// history 꼬리에서 마지막 assistant 이후로 이어지는 연속 tool 결과 묶음(=이번 턴에 방금
/// 생성된 결과들) 중 표시 지침 대상 tool 결과의 (message id, 지침)을 반환. 없으면 None.
/// 모델이 텍스트로 답하면 그 뒤에 assistant 메시지가 붙어 묶음이 깨지므로, tool 호출 직후
/// iteration에서만 Some이 된다 → 이후 일상 턴에는 지침이 재노출되지 않는다(누적 방지).
/// 한 iteration에서 read-only tool이 여러 개 실행돼 대상 결과가 꼬리 중간에 묻혀도 잡는다.
fn present_decorate_target(history: &[StoredMessage]) -> Option<(i64, &'static str)> {
    for m in history.iter().rev() {
        if m.role != "tool" {
            break; // assistant/user를 만나면 꼬리 tool 묶음 종료
        }
        if let Some(hint) = hint_for_tool(m.tool_name.as_deref().unwrap_or("")) {
            return Some((m.id, hint));
        }
    }
    None
}

/// tool 결과(JSON 문자열)에 표시 지침을 구조적으로 동봉. 원본은 데이터/지침이 분리되도록
/// `_present` 형제 필드로 감싼다. 원본이 JSON이 아니면 평문으로 뒤에 덧붙인다.
fn decorate_with_hint(original: &str, hint: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(original) {
        Ok(value) => serde_json::json!({
            "result": value,
            "_present": hint,
        })
        .to_string(),
        Err(_) => format!("{original}\n\n{hint}"),
    }
}

fn stored_to_chat(m: &StoredMessage) -> Option<ChatMessage> {
    let role = match m.role.as_str() {
        "system" => Role::System,
        "user" => Role::User,
        "assistant" => Role::Assistant,
        "tool" => Role::Tool,
        _ => return None,
    };
    let tool_calls = m
        .tool_calls_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<ToolCall>>(s).ok())
        .filter(|v| !v.is_empty());
    Some(ChatMessage {
        role,
        content: m.content.clone(),
        tool_calls,
        tool_call_id: m.tool_call_id.clone(),
        name: None,
    })
}

#[allow(clippy::too_many_arguments)]
async fn persist_message(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    conv_id: &str,
    role: &str,
    content: Option<&str>,
    tool_call_id: Option<&str>,
    tool_name: Option<&str>,
    tool_calls_json: Option<&str>,
    ts: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO messages (user_id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(conv_id)
    .bind(role)
    .bind(content.unwrap_or(""))
    .bind(tool_call_id)
    .bind(tool_name)
    .bind(tool_calls_json)
    .bind(ts)
    .execute(pool)
    .await?;
    Ok(())
}

async fn today_cost_usd(pool: &sqlx::SqlitePool, user_id: i64) -> AppResult<f64> {
    let now = Local::now();
    let day_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(now.timezone())
        .unwrap()
        .to_utc()
        .to_rfc3339();
    let total: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE user_id = ? AND ts >= ?",
    )
    .bind(user_id)
    .bind(&day_start)
    .fetch_one(pool)
    .await?;
    Ok(total)
}

async fn record_cost(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    model: &str,
    input_tokens: u32,
    output_tokens: u32,
    cost: f64,
) -> AppResult<()> {
    let ts = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO cost_ledger (user_id, ts, provider, kind, model, input_tokens, output_tokens, cost_usd) \
         VALUES (?, ?, 'openai', 'chat', ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(&ts)
    .bind(model)
    .bind(input_tokens as i64)
    .bind(output_tokens as i64)
    .bind(cost)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct CostSummary {
    pub today_usd: f64,
    pub month_usd: f64,
    pub last_7_days_usd: f64,
    pub total_calls: i64,
}

pub async fn cost_summary(state: &AppState, user_id: i64) -> AppResult<CostSummary> {
    let now = Local::now();
    let day_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(now.timezone())
        .unwrap()
        .to_utc()
        .to_rfc3339();
    let week_start = (Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    let month_start = Utc::now()
        .with_timezone(&Local)
        .date_naive()
        .with_day(1)
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|n| n.and_local_timezone(now.timezone()).unwrap().to_utc().to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    let today: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE user_id = ? AND ts >= ?",
    )
    .bind(user_id)
    .bind(&day_start)
    .fetch_one(&state.db)
    .await?;
    let week: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE user_id = ? AND ts >= ?",
    )
    .bind(user_id)
    .bind(&week_start)
    .fetch_one(&state.db)
    .await?;
    let month: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE user_id = ? AND ts >= ?",
    )
    .bind(user_id)
    .bind(&month_start)
    .fetch_one(&state.db)
    .await?;
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cost_ledger WHERE user_id = ?")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;

    Ok(CostSummary {
        today_usd: today,
        month_usd: month,
        last_7_days_usd: week,
        total_calls: total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: i64, role: &str, tool_name: Option<&str>) -> StoredMessage {
        StoredMessage {
            id,
            conversation_id: "c".into(),
            role: role.into(),
            content: Some("{}".into()),
            tool_call_id: tool_name.map(|_| format!("call_{id}")),
            tool_name: tool_name.map(|s| s.to_string()),
            tool_calls_json: None,
            ts: "2026-06-11T00:00:00+09:00".into(),
        }
    }

    #[test]
    fn decorates_briefing_result_at_tail() {
        let history = vec![
            msg(1, "user", None),
            msg(2, "assistant", Some("list_today_overview")),
            msg(3, "tool", Some("list_today_overview")),
        ];
        assert_eq!(
            present_decorate_target(&history),
            Some((3, BRIEFING_PRESENT_HINT))
        );
    }

    #[test]
    fn finds_briefing_result_buried_in_multi_tool_run() {
        // 한 iteration에서 대상 tool + 다른 read-only tool이 연달아 실행돼
        // 대상 결과가 꼬리 마지막이 아니어도 잡아야 한다.
        let history = vec![
            msg(1, "assistant", Some("list_today_overview")),
            msg(2, "tool", Some("list_today_overview")),
            msg(3, "tool", Some("list_todos")),
        ];
        assert_eq!(
            present_decorate_target(&history),
            Some((2, BRIEFING_PRESENT_HINT))
        );
    }

    #[test]
    fn schedule_tool_gets_schedule_hint() {
        // 힌트 맵(#4)이 tool별로 다른 지침을 고른다.
        let history = vec![
            msg(1, "assistant", Some("suggest_schedule")),
            msg(2, "tool", Some("suggest_schedule")),
        ];
        assert_eq!(
            present_decorate_target(&history),
            Some((2, SCHEDULE_PRESENT_HINT))
        );
    }

    #[test]
    fn no_decorate_after_assistant_answered() {
        // 모델이 이미 텍스트로 답해 assistant가 꼬리에 붙으면 freshness가 깨져 None.
        let history = vec![
            msg(1, "assistant", Some("list_today_overview")),
            msg(2, "tool", Some("list_today_overview")),
            msg(3, "assistant", None),
        ];
        assert_eq!(present_decorate_target(&history), None);
    }

    #[test]
    fn no_decorate_for_non_target_tail() {
        let history = vec![
            msg(1, "assistant", Some("list_todos")),
            msg(2, "tool", Some("list_todos")),
        ];
        assert_eq!(present_decorate_target(&history), None);
    }

    #[test]
    fn decorate_with_hint_wraps_json_structurally() {
        let out = decorate_with_hint("{\"events\":[]}", BRIEFING_PRESENT_HINT);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v.get("result").is_some());
        assert_eq!(v["_present"], serde_json::Value::String(BRIEFING_PRESENT_HINT.into()));
    }

    #[test]
    fn decorate_with_hint_falls_back_on_non_json() {
        let out = decorate_with_hint("not json", BRIEFING_PRESENT_HINT);
        assert!(out.starts_with("not json"));
        assert!(out.contains(BRIEFING_PRESENT_HINT));
    }
}
