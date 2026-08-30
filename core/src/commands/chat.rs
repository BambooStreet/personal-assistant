use chrono::{Datelike, Local, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::services::llm::cost::estimate_chat_cost_usd;
use crate::services::llm::dispatch;
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
// 할 일·일정 목록은 **클라이언트가 렌더한다**(데스크톱 = 채팅 카드, 텔레그램 = 봇 평문 포맷터).
// 따라서 아래 지침들은 모델에게 "나열하지 말고 요약만" 을 요구한다 — 같은 목록을 두 번 보여주지
// 않기 위함이자, 모델이 목록을 받아쓰다 값을 틀리는 경로를 없애기 위함. 자세한 배경은
// docs/UI/chat-cards.md.
// 시각 규칙 공통: start_at/end_at/due_at은 UTC라 요약에서 특정 항목을 언급할 때는 반드시
// 사용자 타임존으로 변환해 'HH:MM'/'M/D'로만 쓰고 원본 타임스탬프를 노출하지 않는다.
const BRIEFING_PRESENT_HINT: &str = "표시 지침: 이 결과로 오늘을 한눈에 요약한다. \
구조만 따르고 어조는 시스템 지침을 그대로 쓴다(여기서 톤을 새로 정하지 않음). \
목록은 카드로 이미 표시되니 일정·할 일을 하나씩 나열하지 않는다. \
대신 ① 오늘 일정 N건·할 일 N건인지, ② 가장 먼저 챙길 것 한두 가지(가장 이른 일정 또는 \
기한이 임박하거나 priority가 높은 할 일)를 짚어 두세 문장으로 말한다. \
시각을 언급할 땐 UTC인 start_at/due_at을 사용자 타임존으로 변환해 'HH:MM'(24시간제)로만 쓰고 \
'…T…Z' 원본 타임스탬프는 절대 노출하지 않는다. 우선순위 숫자도 노출하지 않는다. \
둘 다 비어 있으면 '오늘은 등록된 일정과 할 일이 없다'고만 답한다. \
이전 대화에 항목을 나열한 답이 있어도 그 형식을 따라 하지 않는다.";

const UPCOMING_PRESENT_HINT: &str = "표시 지침: '다가오는 일정'을 요약한다. 어조는 시스템 지침을 \
따른다. 목록은 카드로 이미 표시되니 일정을 하나씩 나열하지 않는다. 총 N건인지와 가장 가까운 \
일정 하나(언제·무엇)만 짚어 한두 문장으로 말한다. 시각을 언급할 땐 UTC인 start_at을 사용자 \
타임존으로 변환해 'M/D HH:MM'으로만 쓰고 '…T…Z' 원본 타임스탬프는 노출하지 않는다. \
결과가 비어 있으면 '예정된 일정이 없다'고만 답한다. \
이전 대화에 항목을 나열한 답이 있어도 그 형식을 따라 하지 않는다.";

const SCHEDULE_PRESENT_HINT: &str = "표시 지침: 이 결과로 '오늘 일과 추천'을 제시한다. 어조는 \
시스템 지침을 따른다. free_slots 안에서만 배치를 말하고(슬롯 밖/겹침 금지), proposed는 베이스라인이며 \
마감·중요도를 고려해 순서를 조정·설명해도 된다. 구조: ① 시간순으로 '〈HH:MM–HH:MM〉 〈할 일〉(예상 N분)'을 \
나열하고 각 항목에 배치 사유 한 줄(마감/중요도). ② unplaced 항목은 사유(소요시간 미입력/빈 시간 부족)와 함께 \
따로 안내. ③ 마지막에 한 줄 요약. 끝에 '이대로 캘린더에 넣어드릴까요?'로 확인을 받고, 수락하면 schedule_commit을 호출한다.";

const TODOS_PRESENT_HINT: &str = "표시 지침: 이 결과를 요약한다. 구조만 따르고 어조는 시스템 \
지침을 그대로 쓴다(여기서 톤을 새로 정하지 않음). 목록은 카드로 이미 표시되니 할 일을 하나씩 \
나열하지 않는다. 총 N건인지와, 지금 챙겨야 할 한두 건(기한이 지났거나 임박한 것, 없으면 \
priority가 높은 것)만 짚어 두 문장 이내로 말한다. 기한을 언급할 땐 UTC인 due_at을 사용자 \
타임존으로 변환해 오늘이면 'HH:MM'(24시간제), 다른 날이면 'M/D'로 쓰고 '…T…Z' 원본 \
타임스탬프는 절대 노출하지 않는다. 우선순위 숫자도 노출하지 않는다. \
결과가 비어 있으면 '등록된 할 일이 없다'고만 답한다. \
좋은 예: '할 일 3건이에요. 쿠팡 댓글 논문이 6/30 기한을 넘겼어요.' \
나쁜 예: '• 항목1 · 6/18 • 항목2 …' 처럼 항목을 옮겨 적는 것(이전 대화에 그런 답이 \
있어도 따라 하지 않는다).";

const TRAVEL_PRESENT_HINT: &str = "표시 지침: 이 결과로 '오늘 이동 동선'을 브리핑한다. 어조는 \
시스템 지침을 따른다. 시각 변환: 각 leg의 depart_by·start_at은 UTC 타임스탬프다 — 사용자 타임존으로 \
바꿔 'HH:MM'(24시간제)로만 쓰고, 'depart_by'·'start_at' 같은 필드명이나 '…T…Z' 원본은 절대 출력하지 \
않는다. 형식: 구간마다 아래 예시처럼 쓰고 구간과 구간 사이에는 빈 줄을 둔다. \
예시 ↓\n\
🚇 **16:30 출발** · 성균관로5길 81 → 서현역 로데오거리 (18:00 도착)\n\
· 대중교통 80분 · 환승 2회\n\
· 경로: 수인분당선 서현→왕십리 / 2호선 왕십리→동대문역사문화공원\n\
위 숫자·장소·노선은 예시이니 실제 값으로 대체한다: 출발/도착 시각 = 변환한 depart_by/start_at, \
'대중교통 N분' = duration_min, '환승 K회' = transfers(0이면 '환승 없음'), '경로:' 줄 = route_detail \
(비어 있으면 '경로:' 줄 생략). from/to는 결과의 값을 그대로 쓰고 주소를 덧붙이지 않는다. \
마지막 줄에 '총 N개 구간'. 결과가 비어 있으면 '그날은 계산된 이동 동선이 없어요'라고만 답한다. \
시각·소요시간·환승·경로를 임의로 지어내지 말고 결과에 있는 값만 쓴다.";

// 쓰기 도구 승인 직후 결과에 붙는 지침. Core는 한 턴에 **쓰기 도구를 1건만** 실행하고 뒤따르는
// tool_call은 폐기한다(run_agent_loop의 prefix 규칙) — UI confirm이 1건 단위라서다. 그래서
// "지난 할 일 다 지워줘"처럼 여러 건을 요청하면 첫 건만 처리되고 끊긴다. 이 지침이 재개된
// 루프에서 모델에게 남은 작업을 이어가라고 알려 그 구멍을 메운다(프롬프트 기반 — D-016과 같은 결).
const WRITE_FOLLOWUP_HINT: &str = "진행 지침: 방금 한 건을 처리했다. 사용자가 요청한 작업 중 아직 \
처리되지 않은 항목이 남아 있으면 마무리하지 말고 지금 이어서 해당 도구를 호출한다(한 번에 한 건씩, \
남은 게 없어질 때까지 반복). 예: 기한 지난 할 일 2건 삭제 요청이면 첫 건 삭제 후 곧바로 둘째 건 \
삭제를 호출한다. 남은 항목이 하나도 없을 때만 한 문장으로 마무리한다. 처리 결과 목록은 UI 카드가 \
보여주므로 항목을 나열하지 않는다.";

// tool_name → 표시 지침 매핑. 해당 tool 결과가 방금 생성됐을 때만 조립 시점에 1회 주입.
const PRESENT_HINTS: &[(&str, &str)] = &[
    ("list_today_overview", BRIEFING_PRESENT_HINT),
    ("list_today_events", BRIEFING_PRESENT_HINT),
    ("list_upcoming_events", UPCOMING_PRESENT_HINT),
    ("list_todos", TODOS_PRESENT_HINT),
    ("suggest_schedule", SCHEDULE_PRESENT_HINT),
    ("plan_travel", TRAVEL_PRESENT_HINT),
    // 쓰기 도구 — 승인 후 재개된 루프에서 남은 작업을 이어가게 한다.
    ("create_todo", WRITE_FOLLOWUP_HINT),
    ("complete_todo", WRITE_FOLLOWUP_HINT),
    ("update_todo", WRITE_FOLLOWUP_HINT),
    ("delete_todo", WRITE_FOLLOWUP_HINT),
    ("create_event", WRITE_FOLLOWUP_HINT),
    ("update_event", WRITE_FOLLOWUP_HINT),
    ("delete_event", WRITE_FOLLOWUP_HINT),
];

fn hint_for_tool(name: &str) -> Option<&'static str> {
    PRESENT_HINTS.iter().find(|(n, _)| *n == name).map(|(_, h)| *h)
}

/// 이번 턴에 자동 실행한 읽기 도구의 결과. content는 도구가 낸 원본 JSON 문자열 그대로.
/// 렌더러가 도구명으로 분기해 카드로 그린다(표시 가공은 UI 몫 — Core는 데이터만 넘긴다).
#[derive(Debug, Serialize, Clone)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub name: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ChatTurn {
    pub assistant_text: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    /// 읽기 도구 결과(카드용). 쓰기 도구는 여기 담기지 않음 — confirm 카드가 담당.
    pub tool_results: Vec<ToolResult>,
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
            tool_results: vec![],
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

    let mut turn = run_agent_loop(state, user_id, &conv_id).await?;

    // 쓰기가 실제로 성공했으면 갱신된 목록을 카드 한 장으로 덧붙인다 — 추가/완료/삭제 직후
    // 사용자가 "그래서 지금 목록이 어떻게 됐지?"를 다시 묻지 않아도 되게.
    //
    // 단 **연속 작업의 마지막 턴에만** 붙인다. 승인 대기 중인 쓰기가 또 있으면
    // (= turn.tool_calls 비어 있지 않음) 아직 작업이 끝나지 않은 것이므로, 중간 상태의 목록을
    // 여러 번 띄우지 않고 마무리 안내와 함께 한 번만 보여준다.
    let write_ok = args.approved
        && serde_json::from_str::<serde_json::Value>(&content)
            .map(|v| v.get("error").is_none() && v.get("rejected").is_none())
            .unwrap_or(false);
    if write_ok && turn.tool_calls.is_empty() {
        if let Some(fresh) = fresh_list_after_write(state, user_id, &args.tool_name).await {
            // 모델이 이번 턴에 같은 목록을 이미 조회했으면 카드가 겹치므로 덧붙이지 않는다.
            if !turn.tool_results.iter().any(|r| r.name == fresh.name) {
                turn.tool_results.push(fresh);
            }
        }
    }

    Ok(turn)
}

/// 쓰기 도구 승인 직후 붙일 "갱신된 목록" 카드. 읽기 도구를 그대로 재사용해 카드 파서가
/// 아는 형태를 만든다.
///
/// history(tool 메시지)로는 저장하지 않는다 — 짝 없는 tool 메시지는 OpenAI 프로토콜을 깨고
/// sanitize_tool_pairing에 걸린다. 따라서 이 카드는 **세션 한정**이며, 패널을 다시 열면
/// 사라진다(그때는 사용자가 다시 물으면 된다).
async fn fresh_list_after_write(
    state: &AppState,
    user_id: i64,
    tool_name: &str,
) -> Option<ToolResult> {
    let list_tool = match tool_name {
        "create_todo" | "complete_todo" | "update_todo" | "delete_todo" => "list_todos",
        "create_event" | "update_event" | "delete_event" | "schedule_commit" => {
            "list_upcoming_events"
        }
        _ => return None,
    };
    let content = dispatch::execute_tool(state, user_id, list_tool, serde_json::json!({}))
        .await
        .ok()?;
    Some(ToolResult {
        // 실제 tool_call이 아니므로 충돌하지 않는 접두사를 쓴다(렌더러에서 카드 key로만 사용).
        tool_call_id: format!("refresh:{tool_name}"),
        name: list_tool.to_string(),
        content,
    })
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

/// Role → trace 속성용 문자열.
fn role_str(r: &Role) -> &'static str {
    match r {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    }
}

/// OpenAI tool 프로토콜 정합성 복구. 히스토리가 꼬여도 전송 직전에 다음을 보장:
/// - 응답(tool 메시지) 없는 assistant tool_call은 제거(없으면 "must be followed by tool messages" 400).
/// - 선언(assistant tool_calls)되지 않은 tool 메시지는 제거("must be a response to preceding tool_calls" 400).
/// tool_call이 전부 빠진 assistant는 텍스트가 있으면 일반 메시지로 남기고, 없으면 통째로 제거.
fn sanitize_tool_pairing(msgs: Vec<ChatMessage>) -> Vec<ChatMessage> {
    use std::collections::HashSet;
    let mut declared: HashSet<String> = HashSet::new();
    let mut answered: HashSet<String> = HashSet::new();
    for m in &msgs {
        match m.role {
            Role::Assistant => {
                if let Some(tcs) = &m.tool_calls {
                    for tc in tcs {
                        declared.insert(tc.id.clone());
                    }
                }
            }
            Role::Tool => {
                if let Some(id) = &m.tool_call_id {
                    answered.insert(id.clone());
                }
            }
            _ => {}
        }
    }

    let mut out = Vec::with_capacity(msgs.len());
    for mut m in msgs {
        match m.role {
            Role::Assistant => match m.tool_calls.take() {
                Some(tcs) => {
                    let kept: Vec<ToolCall> =
                        tcs.into_iter().filter(|tc| answered.contains(&tc.id)).collect();
                    let has_content =
                        m.content.as_deref().map(|c| !c.trim().is_empty()).unwrap_or(false);
                    if kept.is_empty() {
                        if has_content {
                            m.tool_calls = None;
                            out.push(m);
                        }
                        // 텍스트도 없고 응답된 tool_call도 없으면 제거.
                    } else {
                        m.tool_calls = Some(kept);
                        out.push(m);
                    }
                }
                None => out.push(m),
            },
            Role::Tool => {
                let paired = m
                    .tool_call_id
                    .as_ref()
                    .map(|id| declared.contains(id))
                    .unwrap_or(false);
                if paired {
                    out.push(m);
                }
            }
            _ => out.push(m),
        }
    }
    out
}

/// 턴 종료 계측(D-023). 텍스트도 pending 도구도 없이 끝나면 화면에 아무것도 안 남으므로
/// WARN으로 올린다 — 그 경우가 "에러도 없이 조용히 사라지는" 유일한 경로다.
#[allow(clippy::too_many_arguments)]
fn log_turn_end(
    user_id: i64,
    reason: &str,
    started: std::time::Instant,
    iterations: u32,
    text: Option<&str>,
    pending_tool_calls: usize,
    input_tokens: u32,
    output_tokens: u32,
    cost_usd: f64,
) {
    let text_chars = text.map(|t| t.trim().chars().count()).unwrap_or(0);
    let elapsed_ms = started.elapsed().as_millis() as u64;
    if text_chars == 0 && pending_tool_calls == 0 {
        tracing::warn!(
            user_id,
            reason,
            elapsed_ms,
            iterations,
            input_tokens,
            output_tokens,
            cost_usd,
            "chat turn end — 표시할 내용 없음"
        );
        return;
    }
    tracing::info!(
        user_id,
        reason,
        elapsed_ms,
        iterations,
        text_chars,
        pending_tool_calls,
        input_tokens,
        output_tokens,
        cost_usd,
        "chat turn end"
    );
}

/// LLM 호출 → tool_call이 있으면 read-only는 자동 실행하고 다음 iteration,
/// write 도구는 pending으로 반환. 텍스트 응답이 나오면 종료.
async fn run_agent_loop(state: &AppState, user_id: i64, conv_id: &str) -> AppResult<ChatTurn> {
    let user_name = read_user_name(&state.db, user_id).await?;

    let mut total_input_tokens: u32 = 0;
    let mut total_output_tokens: u32 = 0;
    let mut total_cost: f64 = 0.0;
    let mut last_finish = FinishReason::Other;
    let mut last_text: Option<String> = None;
    // 이번 턴에 자동 실행한 읽기 도구 결과 누적(카드용). iteration을 넘어가며 쌓인다.
    let mut tool_results: Vec<ToolResult> = Vec::new();
    // LangSmith trace 턴 span(옵인). 비활성이면 None — Drop 시 자동 종료되어 return 경로 무관.
    let mut turn_span: Option<crate::infra::telemetry::TurnSpan> = None;
    // 턴 계측(D-023). 원격 모드에선 이 로그가 사후 진단의 유일한 단서다.
    let turn_started = std::time::Instant::now();
    let mut iterations: u32 = 0;

    tracing::info!(user_id, conv = %conv_id, "chat turn start");

    for _ in 0..MAX_AGENT_ITERATIONS {
        iterations += 1;
        let llm_started = std::time::Instant::now();
        // 첫 호출만 해도 10초가 걸린다 — 화면이 죽은 게 아님을 알린다(D-023).
        state.emit("chat.progress", serde_json::json!({"phase": "thinking"}));
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
        // 턴 span은 한 번만 생성(첫 iteration, 사용자 메시지로 라벨). 비활성이면 None.
        if turn_span.is_none() {
            turn_span = crate::infra::telemetry::start_turn(last_user_query);
        }
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
        // OpenAI 프로토콜 정합성: 짝 없는 tool_calls/tool 메시지를 제거(orphan 400 방지).
        // close_orphan_tool_calls가 마지막 assistant만 닫는 걸 보완 — 히스토리 전체를 본다.
        let messages = sanitize_tool_pairing(messages);

        // trace 활성 시에만 프롬프트 사본 확보(messages가 req로 이동하기 전).
        let prompt_trace: Option<Vec<(String, Option<String>)>> = turn_span.as_ref().map(|_| {
            messages
                .iter()
                .map(|m| (role_str(&m.role).to_string(), m.content.clone()))
                .collect()
        });

        let req = ChatRequest {
            model: DEFAULT_MODEL.to_string(),
            messages,
            tools: default_toolset(),
            // gpt-5-mini는 temperature 커스터마이즈 불가 (default=1만 허용). None이면
            // adapter가 필드를 통째로 생략해 OpenAI 기본값을 쓴다.
            temperature: None,
        };

        let resp = state.llm.chat(&state.secrets, req).await?;

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

        // 본문은 남기지 않는다(개인정보) — 길이와 메타만. 이 줄로 "느린 건지 빈 응답인지"가 갈린다.
        tracing::info!(
            user_id,
            iteration = iterations,
            elapsed_ms = llm_started.elapsed().as_millis() as u64,
            model = %resp.model,
            finish = ?last_finish,
            text_chars = assistant_text.as_deref().map(|t| t.chars().count()).unwrap_or(0),
            tool_calls = tool_calls_full.len(),
            input_tokens = resp.usage.input_tokens,
            output_tokens = resp.usage.output_tokens,
            "chat llm call"
        );

        // LLM 호출 1건을 turn 아래 자식 span(llm)으로 기록.
        if let (Some(ts), Some(prompt)) = (turn_span.as_ref(), prompt_trace.as_ref()) {
            ts.record_llm(
                &resp.model,
                prompt,
                resp.usage.input_tokens,
                resp.usage.output_tokens,
                assistant_text.as_deref(),
            );
        }

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
            log_turn_end(
                user_id,
                "text",
                turn_started,
                iterations,
                assistant_text.as_deref(),
                0,
                total_input_tokens,
                total_output_tokens,
                total_cost,
            );
            return Ok(ChatTurn {
                assistant_text,
                tool_calls: vec![],
                tool_results,
                finish_reason: last_finish,
                input_tokens: total_input_tokens,
                output_tokens: total_output_tokens,
                cost_usd: total_cost,
            });
        }

        // prefix 순회: read-only는 자동 실행하고, write 만나면 pending 반환.
        for call in prefix.into_iter() {
            if dispatch::is_read_only(&call.name) {
                let tool_started = std::time::Instant::now();
                state.emit(
                    "chat.progress",
                    serde_json::json!({"phase": "tool", "tool": call.name}),
                );
                // 도구 인자는 로깅하지 않는다 — 일정 제목·주소 등 개인정보가 들어온다.
                let (result, ok) = match dispatch::execute_tool(
                    state,
                    user_id,
                    &call.name,
                    call.arguments.clone(),
                )
                .await
                {
                    Ok(s) => (s, true),
                    Err(e) => {
                        tracing::warn!(user_id, tool = %call.name, error = %e, "chat tool failed");
                        (serde_json::json!({"error": e.to_string()}).to_string(), false)
                    }
                };
                tracing::info!(
                    user_id,
                    tool = %call.name,
                    ok,
                    elapsed_ms = tool_started.elapsed().as_millis() as u64,
                    result_bytes = result.len(),
                    "chat tool executed"
                );
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
                if let Some(ts) = turn_span.as_ref() {
                    ts.record_tool(&call.name, &call.arguments.to_string(), &result);
                }
                // 렌더러가 카드로 그릴 수 있게 원본 결과를 그대로 실어 보낸다.
                tool_results.push(ToolResult {
                    tool_call_id: call.id.clone(),
                    name: call.name.clone(),
                    content: result.clone(),
                });
            } else {
                // write 도구 → pending으로 반환. UI confirm 후 chat_continue로 이어짐.
                log_turn_end(
                    user_id,
                    "pending_write",
                    turn_started,
                    iterations,
                    assistant_text.as_deref(),
                    1,
                    total_input_tokens,
                    total_output_tokens,
                    total_cost,
                );
                return Ok(ChatTurn {
                    assistant_text,
                    tool_calls: vec![call],
                    tool_results,
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
    let fallback_text =
        last_text.or_else(|| Some("죄송해요, 처리 단계가 너무 길어졌어요.".into()));
    log_turn_end(
        user_id,
        "max_iterations",
        turn_started,
        iterations,
        fallback_text.as_deref(),
        0,
        total_input_tokens,
        total_output_tokens,
        total_cost,
    );
    Ok(ChatTurn {
        assistant_text: fallback_text,
        tool_calls: vec![],
        tool_results,
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
         - 한국어로 친근하고 간결하게 답합니다(보통 1~3문장).\n\
         - 말투는 **해요체로 통일**합니다. 모든 문장을 '~해요/~예요/~할까요?/~드릴게요/ \
         ~주세요'로 끝냅니다. 반말('~해줘', '~야', '~했어')과 합쇼체('~습니다', '~입니다')는 \
         쓰지 않습니다. **한 답변 안에서 말투를 섞는 것은 특히 금지**입니다. \
         나쁜 예: '삭제 완료했습니다. 다른 요청 있으면 말해줘.' \
         좋은 예: '삭제했어요. 더 필요한 게 있으면 말씀해 주세요.'\n\
         - 할 일·일정 목록은 화면 UI가 카드로 직접 보여줍니다. 그러니 조회 결과를 \
         항목별로 옮겨 적지 말고, 건수와 지금 챙길 핵심 한두 가지만 말합니다. \
         불릿(•)·번호목록·표로 전체를 나열하는 것은 금지입니다.\n\
         - 사용자에게 할 말만 출력합니다. 문체 이름(예: Hemingway)·스타일 라벨·모델 메타 \
         코멘트를 답변 앞뒤에 덧붙이지 않습니다. 간결하게 쓰라는 지시는 문장을 짧게 하라는 \
         뜻이지, 문체 이름을 표기하라는 뜻이 아닙니다.\n\
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

pub(crate) async fn read_user_name(
    pool: &sqlx::SqlitePool,
    user_id: i64,
) -> AppResult<Option<String>> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind("user.name")
            .fetch_optional(pool)
            .await?
            .flatten();
    Ok(raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

pub(crate) async fn load_recent_messages(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    conv_id: &str,
    cap: i64,
) -> AppResult<Vec<StoredMessage>> {
    // 부팅 인사(source='greeting')는 **가장 최근 1건만** 컨텍스트에 넣는다(D-025).
    // 전부 빼면 "오늘 뭐 할 거예요?"에 사용자가 답했을 때 LLM이 자기 질문을 못 봐서
    // 대화가 끊기고, 전부 넣으면 켤 때마다 쌓여 cap(40)이 인사로 도배된다.
    // 화면용 `chat_history`는 필터하지 않는다 — 지난 인사도 스크롤하면 보여야 한다.
    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts \
         FROM messages WHERE user_id = ? AND conversation_id = ? \
           AND (source IS NULL OR source != 'greeting' \
                OR id = (SELECT MAX(id) FROM messages \
                         WHERE user_id = ? AND conversation_id = ? AND source = 'greeting')) \
         ORDER BY id DESC LIMIT ?",
    )
    .bind(user_id)
    .bind(conv_id)
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

    fn cm(
        role: Role,
        content: Option<&str>,
        tool_calls: Option<Vec<&str>>,
        tool_call_id: Option<&str>,
    ) -> ChatMessage {
        ChatMessage {
            role,
            content: content.map(|s| s.to_string()),
            tool_calls: tool_calls.map(|ids| {
                ids.into_iter()
                    .map(|id| ToolCall {
                        id: id.to_string(),
                        name: "t".into(),
                        arguments: serde_json::Value::Null,
                    })
                    .collect()
            }),
            tool_call_id: tool_call_id.map(|s| s.to_string()),
            name: None,
        }
    }

    #[test]
    fn sanitize_drops_orphan_tool() {
        // 선언 안 된 tool 메시지 제거.
        let out = sanitize_tool_pairing(vec![
            cm(Role::User, Some("hi"), None, None),
            cm(Role::Tool, Some("{}"), None, Some("call_x")),
        ]);
        assert_eq!(out.len(), 1);
        assert!(matches!(out[0].role, Role::User));
    }

    #[test]
    fn sanitize_drops_unanswered_toolcall_only_message() {
        // 응답 없는 tool_call만 있고 텍스트 없음 → 통째로 제거.
        let out = sanitize_tool_pairing(vec![cm(
            Role::Assistant,
            None,
            Some(vec!["call_x"]),
            None,
        )]);
        assert!(out.is_empty());
    }

    #[test]
    fn sanitize_keeps_unanswered_toolcall_text_as_plain() {
        // 응답 없는 tool_call + 텍스트 → tool_calls 떼고 일반 메시지로 유지.
        let out = sanitize_tool_pairing(vec![cm(
            Role::Assistant,
            Some("답"),
            Some(vec!["call_x"]),
            None,
        )]);
        assert_eq!(out.len(), 1);
        assert!(out[0].tool_calls.is_none());
        assert_eq!(out[0].content.as_deref(), Some("답"));
    }

    #[test]
    fn sanitize_keeps_valid_pair_and_drops_partial() {
        // [call_x, call_y] 중 call_x만 응답됨 → assistant는 call_x만 유지, tool(call_x) 유지.
        let out = sanitize_tool_pairing(vec![
            cm(Role::Assistant, None, Some(vec!["call_x", "call_y"]), None),
            cm(Role::Tool, Some("{}"), None, Some("call_x")),
        ]);
        assert_eq!(out.len(), 2);
        let tcs = out[0].tool_calls.as_ref().unwrap();
        assert_eq!(tcs.len(), 1);
        assert_eq!(tcs[0].id, "call_x");
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
        // (꼬리 tool은 힌트 대상이 아닌 것으로 둔다 — 대상이면 그쪽이 선택되는 게 정상.)
        let history = vec![
            msg(1, "assistant", Some("list_today_overview")),
            msg(2, "tool", Some("list_today_overview")),
            msg(3, "tool", Some("search_memory")),
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
        // PRESENT_HINTS에 없는 도구(search_memory)는 지침을 붙이지 않는다.
        let history = vec![
            msg(1, "assistant", Some("search_memory")),
            msg(2, "tool", Some("search_memory")),
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

/// agent loop 통합 테스트 — 가짜 LLM(`testing::FakeLlm`)을 꽂아 네트워크 없이 진짜 루프를 돌린다.
///
/// 여기서 잡으려는 것: 도구 prefix 자르기, 읽기 자동 실행, 쓰기 confirm 반환, 표시 지침 주입,
/// orphan tool_call 정리, max iteration 폴백, 그리고 **빈 응답**(화면에 아무것도 안 남는 경로).
#[cfg(test)]
mod agent_loop_tests {
    use super::*;
    use crate::testing::{llm_empty, llm_text, llm_tool_call, llm_tool_calls, test_state_with_llm};

    const UID: i64 = 1;

    async fn send(state: &AppState, text: &str) -> AppResult<ChatTurn> {
        chat_send(
            state,
            UID,
            ChatSendArgs {
                user_message: text.into(),
                conversation_id: None,
            },
        )
        .await
    }

    async fn stored_roles(state: &AppState) -> Vec<(String, Option<String>)> {
        sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT role, tool_name FROM messages WHERE user_id = ? ORDER BY id ASC",
        )
        .bind(UID)
        .fetch_all(&state.db)
        .await
        .expect("messages 조회")
    }

    #[tokio::test]
    async fn 텍스트_응답이면_한_번만_호출하고_끝난다() {
        let (state, _rx, llm) = test_state_with_llm(vec![llm_text("안녕하세요")]).await;

        let turn = send(&state, "안녕").await.expect("턴 성공");

        assert_eq!(turn.assistant_text.as_deref(), Some("안녕하세요"));
        assert!(turn.tool_calls.is_empty());
        assert!(turn.tool_results.is_empty());
        assert_eq!(llm.call_count(), 1, "도구가 없으면 LLM은 한 번만");
    }

    #[tokio::test]
    async fn 읽기_도구는_자동_실행하고_다음_iteration에서_마무리한다() {
        let (state, _rx, llm) = test_state_with_llm(vec![
            llm_tool_call("c1", "list_todos", serde_json::json!({})),
            llm_text("할 일이 없어요"),
        ])
        .await;

        let turn = send(&state, "할 일 목록").await.expect("턴 성공");

        assert_eq!(turn.assistant_text.as_deref(), Some("할 일이 없어요"));
        assert_eq!(turn.tool_results.len(), 1, "카드용 도구 결과가 실려야 한다");
        assert_eq!(turn.tool_results[0].name, "list_todos");
        assert_eq!(llm.call_count(), 2, "도구 실행 후 마무리 호출까지 2회");

        // user → assistant(tool_calls) → tool → assistant(text) 순으로 저장된다.
        let roles = stored_roles(&state).await;
        let names: Vec<&str> = roles.iter().map(|(r, _)| r.as_str()).collect();
        assert_eq!(names, vec!["user", "assistant", "tool", "assistant"]);
    }

    #[tokio::test]
    async fn 쓰기_도구는_실행하지_않고_confirm으로_반환한다() {
        let (state, _rx, llm) = test_state_with_llm(vec![llm_tool_call(
            "c1",
            "create_todo",
            serde_json::json!({"title": "논문 마무리"}),
        )])
        .await;

        let turn = send(&state, "논문 마무리 추가해줘").await.expect("턴 성공");

        assert_eq!(turn.tool_calls.len(), 1, "confirm 대기 도구가 반환돼야 한다");
        assert_eq!(turn.tool_calls[0].name, "create_todo");
        assert_eq!(llm.call_count(), 1, "승인 전에는 루프를 더 돌지 않는다");

        // 승인 전이므로 실제로 만들어지면 안 된다.
        let todos: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM todos WHERE user_id = ?")
            .bind(UID)
            .fetch_one(&state.db)
            .await
            .expect("todos 조회");
        assert_eq!(todos, 0, "confirm 전에 쓰기가 실행되면 안 된다");
    }

    #[tokio::test]
    async fn 쓰기_앞의_읽기까지만_실행하고_뒤는_폐기한다() {
        let (state, _rx, _llm) = test_state_with_llm(vec![llm_tool_calls(vec![
            ("c1", "list_todos", serde_json::json!({})),
            ("c2", "create_todo", serde_json::json!({"title": "새 할 일"})),
            ("c3", "list_upcoming_events", serde_json::json!({})),
        ])])
        .await;

        let turn = send(&state, "정리해줘").await.expect("턴 성공");

        assert_eq!(turn.tool_results.len(), 1, "쓰기 앞의 읽기만 실행");
        assert_eq!(turn.tool_results[0].name, "list_todos");
        assert_eq!(turn.tool_calls.len(), 1);
        assert_eq!(turn.tool_calls[0].name, "create_todo");
        // c3(쓰기 뒤의 읽기)는 폐기된다 — 필요하면 LLM이 다음 턴에 다시 부른다.
        assert!(
            !turn.tool_results.iter().any(|r| r.name == "list_upcoming_events"),
            "쓰기 뒤의 도구는 폐기돼야 한다"
        );
    }

    #[tokio::test]
    async fn 빈_응답이면_표시할_내용_없이_끝난다() {
        let (state, _rx, _llm) = test_state_with_llm(vec![llm_empty()]).await;

        let turn = send(&state, "할 일 목록").await.expect("턴 성공");

        // 이 조합(텍스트 0 + 도구 0 + 카드 0)이 렌더러가 말풍선을 지워버리는 그 경로다.
        // Core는 에러를 내지 않으므로 UI가 이 상태를 스스로 다뤄야 한다 — D-023의 WARN 대상.
        assert!(turn.assistant_text.as_deref().unwrap_or("").trim().is_empty());
        assert!(turn.tool_calls.is_empty());
        assert!(turn.tool_results.is_empty());
    }

    #[tokio::test]
    async fn 표시_지침은_방금_실행된_도구_결과에만_붙는다() {
        let (state, _rx, llm) = test_state_with_llm(vec![
            llm_tool_call("c1", "list_todos", serde_json::json!({})),
            llm_text("할 일이 없어요"),
        ])
        .await;

        send(&state, "할 일 목록").await.expect("턴 성공");

        // 1회차엔 아직 도구 결과가 없으므로 지침이 없어야 하고,
        let first = llm.request(0);
        assert!(
            !first.messages.iter().any(|m| {
                m.content.as_deref().unwrap_or("").contains("표시 지침")
            }),
            "도구 실행 전에는 표시 지침이 실리면 안 된다"
        );

        // 2회차엔 방금 만든 list_todos 결과에 지침이 덧입혀져야 한다.
        let second = llm.request(1);
        assert!(
            second.messages.iter().any(|m| {
                m.content.as_deref().unwrap_or("").contains("등록된 할 일이 없다")
            }),
            "실행 직후 iteration에는 해당 도구의 표시 지침이 붙어야 한다"
        );
    }

    #[tokio::test]
    async fn max_iteration을_넘기면_안내_문구로_끝낸다() {
        // 매번 읽기 도구만 부르는 LLM → 루프가 상한까지 돌고 폴백 문구로 종료.
        let script = (0..MAX_AGENT_ITERATIONS)
            .map(|i| {
                llm_tool_call(
                    &format!("c{i}"),
                    "list_todos",
                    serde_json::json!({}),
                )
            })
            .collect();
        let (state, _rx, llm) = test_state_with_llm(script).await;

        let turn = send(&state, "할 일 목록").await.expect("턴 성공");

        assert_eq!(llm.call_count(), MAX_AGENT_ITERATIONS as usize);
        assert_eq!(
            turn.assistant_text.as_deref(),
            Some("죄송해요, 처리 단계가 너무 길어졌어요."),
            "빈 손으로 끝내지 말고 안내 문구라도 돌려줘야 한다"
        );
    }

    #[tokio::test]
    async fn 진행_이벤트를_단계마다_쏜다() {
        // 20초짜리 턴 동안 화면이 죽은 게 아님을 알리는 신호(D-023).
        // thinking(LLM 호출) → tool(도구 실행) → thinking(마무리 호출) 순.
        let (state, mut rx, _llm) = test_state_with_llm(vec![
            llm_tool_call("c1", "list_todos", serde_json::json!({})),
            llm_text("할 일이 없어요"),
        ])
        .await;

        send(&state, "할 일 목록").await.expect("턴 성공");

        let mut progress = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            if ev.name == "chat.progress" {
                let phase = ev.data["phase"].as_str().unwrap_or("").to_string();
                let tool = ev.data["tool"].as_str().map(str::to_string);
                progress.push((phase, tool));
            }
        }

        assert_eq!(
            progress,
            vec![
                ("thinking".to_string(), None),
                ("tool".to_string(), Some("list_todos".to_string())),
                ("thinking".to_string(), None),
            ],
        );
    }

    #[tokio::test]
    async fn 승인_안_된_쓰기_도구는_다음_메시지에서_닫힌다() {
        // 1턴: 쓰기 confirm 대기 상태로 끝낸다(사용자가 승인하지 않음).
        // 2턴: 새 메시지를 보내면 orphan tool_call이 합성 tool 메시지로 닫혀야 한다 —
        //      안 닫히면 OpenAI가 400을 낸다.
        let (state, _rx, llm) = test_state_with_llm(vec![
            llm_tool_call("c1", "create_todo", serde_json::json!({"title": "x"})),
            llm_text("네, 알겠어요"),
        ])
        .await;

        send(&state, "할 일 추가해줘").await.expect("1턴");
        send(&state, "아니 됐어").await.expect("2턴");

        let roles = stored_roles(&state).await;
        let tool_rows = roles.iter().filter(|(r, _)| r == "tool").count();
        assert_eq!(tool_rows, 1, "orphan을 닫는 합성 tool 메시지가 있어야 한다");

        // 2턴 요청에 짝 없는 tool_calls가 남아 있으면 안 된다.
        let second = llm.request(1);
        let declared: Vec<String> = second
            .messages
            .iter()
            .filter_map(|m| m.tool_calls.as_ref())
            .flatten()
            .map(|c| c.id.clone())
            .collect();
        for id in declared {
            assert!(
                second
                    .messages
                    .iter()
                    .any(|m| m.tool_call_id.as_deref() == Some(id.as_str())),
                "tool_call {id}에 짝이 되는 tool 메시지가 없다"
            );
        }
    }
}
