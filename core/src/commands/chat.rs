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

pub async fn chat_send(state: &AppState, args: ChatSendArgs) -> AppResult<ChatTurn> {
    let user_text = args.user_message.trim().to_string();
    if user_text.is_empty() {
        return Err(AppError::InvalidInput("empty message".into()));
    }
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());

    enforce_daily_cap(&state.db).await?;

    // 이전 turn에서 도구 confirm을 안 하고 사용자가 새 메시지를 보낸 경우,
    // history에 orphan tool_call이 남아 OpenAI 프로토콜이 깨짐 → 합성 거부 메시지로 닫기.
    close_orphan_tool_calls(&state.db, &conv_id).await?;

    // 사용자 메시지 저장 후 agent loop 진입.
    let user_ts = Utc::now().to_rfc3339();
    persist_message(
        &state.db,
        &conv_id,
        "user",
        Some(&user_text),
        None,
        None,
        None,
        &user_ts,
    )
    .await?;

    run_agent_loop(state, &conv_id).await
}

/// 마지막 assistant 메시지가 tool_calls를 포함하지만 뒤따르는 tool 메시지가 없으면,
/// 합성 거부 메시지를 삽입해 OpenAI history 일관성 유지.
async fn close_orphan_tool_calls(pool: &sqlx::SqlitePool, conv_id: &str) -> AppResult<()> {
    let last = sqlx::query(
        "SELECT id, role, tool_calls_json FROM messages \
         WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
    )
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
    /// 도구 실행 결과(JSON 직렬화 문자열). rejected가 true면 무시됨.
    #[serde(default)]
    pub result: Option<String>,
    /// 사용자가 도구 실행을 거부했는지.
    #[serde(default)]
    pub rejected: bool,
}

/// UI confirm 후 또는 거부 후 호출. tool 결과를 history에 추가하고 agent loop 재개.
pub async fn chat_continue(state: &AppState, args: ChatContinueArgs) -> AppResult<ChatTurn> {
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());

    enforce_daily_cap(&state.db).await?;

    let content = if args.rejected {
        "{\"rejected\":true,\"note\":\"사용자가 도구 실행을 거부했습니다.\"}".to_string()
    } else {
        args.result
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "{\"ok\":true}".into())
    };

    let ts = Utc::now().to_rfc3339();
    persist_message(
        &state.db,
        &conv_id,
        "tool",
        Some(&content),
        Some(&args.tool_call_id),
        Some(&args.tool_name),
        None,
        &ts,
    )
    .await?;

    run_agent_loop(state, &conv_id).await
}

async fn enforce_daily_cap(pool: &sqlx::SqlitePool) -> AppResult<()> {
    let cap = crate::commands::settings::read_daily_cap_usd(pool).await?;
    let today = today_cost_usd(pool).await?;
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
async fn run_agent_loop(state: &AppState, conv_id: &str) -> AppResult<ChatTurn> {
    let user_name = read_user_name(&state.db).await?;
    let adapter = OpenAiAdapter::new(state.http.clone());

    let mut total_input_tokens: u32 = 0;
    let mut total_output_tokens: u32 = 0;
    let mut total_cost: f64 = 0.0;
    let mut last_finish = FinishReason::Other;
    let mut last_text: Option<String> = None;

    for _ in 0..MAX_AGENT_ITERATIONS {
        // 매 iteration마다 history 다시 로드 (방금 저장한 tool/assistant 메시지 포함).
        let history = load_recent_messages(&state.db, conv_id, HISTORY_TURN_CAP).await?;
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
            memory::search_silent(&state.db, last_user_query, RELEVANT_MEMORIES_FOR_PROMPT)
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
        for h in &history {
            if let Some(m) = stored_to_chat(h) {
                messages.push(m);
            }
        }

        let req = ChatRequest {
            model: DEFAULT_MODEL.to_string(),
            messages,
            tools: default_toolset(),
            temperature: Some(0.4),
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
                let result =
                    match dispatch::execute_tool(state, &call.name, call.arguments.clone()).await {
                        Ok(s) => s,
                        Err(e) => serde_json::json!({"error": e.to_string()}).to_string(),
                    };
                let tool_ts = Utc::now().to_rfc3339();
                persist_message(
                    &state.db,
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

pub async fn chat_history(state: &AppState, args: ChatHistoryArgs) -> AppResult<Vec<StoredMessage>> {
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());
    let lim = args.limit.unwrap_or(200).clamp(1, 1000);

    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts \
         FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?",
    )
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

pub async fn chat_clear(state: &AppState, args: ChatClearArgs) -> AppResult<u64> {
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());
    let res = sqlx::query("DELETE FROM messages WHERE conversation_id = ?")
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
         - 한국어로, 친근하지만 간결하게(보통 1~3문장) 답합니다.\n\
         - 일정/할 일 관련 요청은 가능하면 적절한 tool을 호출해 처리합니다.\n\
         - \"할 일/todo/task\"는 list_todos 계열, \"일정/미팅/약속/캘린더\"는 \
         list_today_events·list_upcoming_events 계열을 사용합니다. 둘은 서로 다른 \
         데이터 소스이므로 혼동하지 마세요.\n\
         - 위 \"참고할 사용자 사실\" 블록의 내용은 이미 알고 있는 것으로 간주하고 \
         자연스럽게 활용합니다. 거기 없는 사실이 필요하면 search_memory를 호출하세요. \
         새로 알게 된 재사용 가치 있는 사실은 remember_fact로 저장하세요. 일회성 정보는 저장 X.\n\
         - 시간을 다룰 때는 위 사용자 타임존을 기준으로 ISO 8601 (offset 포함) 형식을 사용합니다.\n\
         - 모호하면 임의로 가정하지 말고 짧게 한 번 더 묻습니다.\n\
         - 사용자가 명시적으로 요청하지 않은 추가 행동은 하지 않습니다.\
         {memory_block}",
        now = now_iso,
        tz = tz,
        name_line = name_line,
        memory_block = memory_block,
    )
}

async fn read_user_name(pool: &sqlx::SqlitePool) -> AppResult<Option<String>> {
    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind("user.name")
        .fetch_optional(pool)
        .await?
        .flatten();
    Ok(raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

async fn load_recent_messages(
    pool: &sqlx::SqlitePool,
    conv_id: &str,
    cap: i64,
) -> AppResult<Vec<StoredMessage>> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts \
         FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
    )
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

async fn persist_message(
    pool: &sqlx::SqlitePool,
    conv_id: &str,
    role: &str,
    content: Option<&str>,
    tool_call_id: Option<&str>,
    tool_name: Option<&str>,
    tool_calls_json: Option<&str>,
    ts: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO messages (conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, ts) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
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

async fn today_cost_usd(pool: &sqlx::SqlitePool) -> AppResult<f64> {
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
        "SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE ts >= ?",
    )
    .bind(&day_start)
    .fetch_one(pool)
    .await?;
    Ok(total)
}

async fn record_cost(
    pool: &sqlx::SqlitePool,
    model: &str,
    input_tokens: u32,
    output_tokens: u32,
    cost: f64,
) -> AppResult<()> {
    let ts = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO cost_ledger (ts, provider, kind, model, input_tokens, output_tokens, cost_usd) \
         VALUES (?, 'openai', 'chat', ?, ?, ?, ?)",
    )
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

pub async fn cost_summary(state: &AppState) -> AppResult<CostSummary> {
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
        "SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE ts >= ?",
    )
    .bind(&day_start)
    .fetch_one(&state.db)
    .await?;
    let week: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE ts >= ?",
    )
    .bind(&week_start)
    .fetch_one(&state.db)
    .await?;
    let month: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE ts >= ?",
    )
    .bind(&month_start)
    .fetch_one(&state.db)
    .await?;
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cost_ledger")
        .fetch_one(&state.db)
        .await?;

    Ok(CostSummary {
        today_usd: today,
        month_usd: month,
        last_7_days_usd: week,
        total_calls: total,
    })
}
