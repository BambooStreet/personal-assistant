use chrono::{Datelike, Local, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::services::llm::cost::estimate_chat_cost_usd;
use crate::services::llm::openai::OpenAiAdapter;
use crate::services::llm::tools::default_toolset;
use crate::services::llm::{ChatMessage, ChatRequest, FinishReason, Role, ToolCall};
use crate::state::AppState;

const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_CONVERSATION: &str = "default";
const HISTORY_TURN_CAP: i64 = 40;

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
    pub ts: String,
}

#[tauri::command]
pub async fn chat_send(state: State<'_, AppState>, args: ChatSendArgs) -> AppResult<ChatTurn> {
    let user_text = args.user_message.trim().to_string();
    if user_text.is_empty() {
        return Err(AppError::InvalidInput("empty message".into()));
    }
    let conv_id = args
        .conversation_id
        .unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());

    let cap = crate::commands::settings::read_daily_cap_usd(&state.db).await?;
    let today = today_cost_usd(&state.db).await?;
    if today >= cap {
        return Err(AppError::Unauthorized(format!(
            "오늘 누적 LLM 비용 ${:.4}이 한도 ${:.2}를 초과했습니다. 설정에서 한도를 조정하세요.",
            today, cap
        )));
    }

    let history = load_recent_messages(&state.db, &conv_id, HISTORY_TURN_CAP).await?;

    let now_local = Local::now();
    let tz = now_local.offset().to_string();
    let system_prompt = build_system_prompt(&now_local.to_rfc3339(), &tz);

    let mut messages: Vec<ChatMessage> = Vec::with_capacity(history.len() + 2);
    messages.push(ChatMessage {
        role: Role::System,
        content: Some(system_prompt),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    });
    for h in history {
        if let Some(m) = stored_to_chat(&h) {
            messages.push(m);
        }
    }
    messages.push(ChatMessage {
        role: Role::User,
        content: Some(user_text.clone()),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    });

    let req = ChatRequest {
        model: DEFAULT_MODEL.to_string(),
        messages,
        tools: default_toolset(),
        temperature: Some(0.4),
    };

    let user_ts = Utc::now().to_rfc3339();
    persist_message(&state.db, &conv_id, "user", Some(&user_text), None, None, &user_ts).await?;

    let adapter = OpenAiAdapter::new(state.http.clone());
    let resp = adapter.chat_with_secrets(&state.secrets, req).await?;

    let assistant_ts = Utc::now().to_rfc3339();
    let assistant_text = resp.message.content.clone();
    let tool_calls = resp.message.tool_calls.clone().unwrap_or_default();
    let tool_name_for_db = tool_calls.first().map(|c| c.name.as_str());

    persist_message(
        &state.db,
        &conv_id,
        "assistant",
        assistant_text.as_deref(),
        None,
        tool_name_for_db,
        &assistant_ts,
    )
    .await?;

    let cost = estimate_chat_cost_usd(&resp.model, resp.usage.input_tokens, resp.usage.output_tokens);
    record_cost(
        &state.db,
        &resp.model,
        resp.usage.input_tokens,
        resp.usage.output_tokens,
        cost,
    )
    .await?;

    Ok(ChatTurn {
        assistant_text,
        tool_calls,
        finish_reason: resp.finish_reason,
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
        cost_usd: cost,
    })
}

#[tauri::command]
pub async fn chat_history(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<StoredMessage>> {
    let conv_id = conversation_id.unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());
    let lim = limit.unwrap_or(200).clamp(1, 1000);

    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, tool_call_id, tool_name, ts \
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
            ts: r.get("ts"),
        })
        .collect())
}

#[tauri::command]
pub async fn chat_clear(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
) -> AppResult<u64> {
    let conv_id = conversation_id.unwrap_or_else(|| DEFAULT_CONVERSATION.to_string());
    let res = sqlx::query("DELETE FROM messages WHERE conversation_id = ?")
        .bind(&conv_id)
        .execute(&state.db)
        .await?;
    Ok(res.rows_affected())
}

fn build_system_prompt(now_iso: &str, tz: &str) -> String {
    format!(
        "당신은 사용자의 책상 위 데스크톱 위젯에 사는 1인용 개인 비서입니다.\n\
         현재 시각: {now}\n\
         사용자 타임존 오프셋: {tz}\n\
         \n\
         규칙:\n\
         - 한국어로, 친근하지만 간결하게(보통 1~3문장) 답합니다.\n\
         - 일정/할 일 관련 요청은 가능하면 적절한 tool을 호출해 처리합니다.\n\
         - 시간을 다룰 때는 위 사용자 타임존을 기준으로 ISO 8601 (offset 포함) 형식을 사용합니다.\n\
         - 모호하면 임의로 가정하지 말고 짧게 한 번 더 묻습니다.\n\
         - 사용자가 명시적으로 요청하지 않은 추가 행동은 하지 않습니다.",
        now = now_iso,
        tz = tz,
    )
}

async fn load_recent_messages(
    pool: &sqlx::SqlitePool,
    conv_id: &str,
    cap: i64,
) -> AppResult<Vec<StoredMessage>> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, tool_call_id, tool_name, ts \
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
    Some(ChatMessage {
        role,
        content: m.content.clone(),
        tool_calls: None,
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
    ts: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO messages (conversation_id, role, content, tool_call_id, tool_name, ts) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(conv_id)
    .bind(role)
    .bind(content.unwrap_or(""))
    .bind(tool_call_id)
    .bind(tool_name)
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
    let total: f64 =
        sqlx::query_scalar("SELECT CAST(COALESCE(SUM(cost_usd), 0) AS REAL) FROM cost_ledger WHERE ts >= ?")
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

#[tauri::command]
pub async fn cost_summary(state: State<'_, AppState>) -> AppResult<CostSummary> {
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
