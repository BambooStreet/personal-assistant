use serde_json::{json, Value};

use crate::commands::calendar::{self, UpcomingArgs};
use crate::commands::memory::{self, MemorySearchArgs};
use crate::commands::todos::{self, TodosListArgs};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

// Read-only(자동 실행) 도구 vs Write(UI confirm 필요) 도구 구분.
// dispatch는 자동 실행만 처리. write는 chat agent loop이 pending tool로 반환.
pub fn is_read_only(name: &str) -> bool {
    matches!(
        name,
        "list_todos"
            | "list_today_events"
            | "list_upcoming_events"
            | "list_today_overview"
            | "suggest_schedule"
            | "search_memory"
    )
}

/// LLM이 호출한 read-only 도구를 직접 실행해서 결과를 LLM-친화적 JSON 문자열로 반환.
/// 호출 실패 시 에러 메시지를 JSON으로 감싸서 반환 (LLM이 읽고 자연어로 마무리하게).
pub async fn execute_tool(
    state: &AppState,
    user_id: i64,
    name: &str,
    args: Value,
) -> AppResult<String> {
    match name {
        "list_todos" => {
            let parsed: TodosListArgs = serde_json::from_value(args).unwrap_or(TodosListArgs {
                include_done: None,
            });
            let rows = todos::todos_list(state, user_id, parsed).await?;
            Ok(serde_json::to_string(&rows)?)
        }
        "list_today_events" => {
            let rows = calendar::calendar_today_events(state, user_id).await?;
            Ok(serde_json::to_string(&rows)?)
        }
        "list_upcoming_events" => {
            let parsed: UpcomingArgs =
                serde_json::from_value(args).unwrap_or(UpcomingArgs { days: None });
            let rows = calendar::calendar_upcoming_events(state, user_id, parsed).await?;
            Ok(serde_json::to_string(&rows)?)
        }
        "search_memory" => {
            let parsed: MemorySearchArgs = serde_json::from_value(args)?;
            let resp = memory::memory_search(state, user_id, parsed).await?;
            Ok(serde_json::to_string(&resp)?)
        }
        "suggest_schedule" => {
            #[derive(serde::Deserialize, Default)]
            struct Args {
                #[serde(default)]
                date: Option<String>,
            }
            let parsed: Args = serde_json::from_value(args).unwrap_or_default();
            let resp =
                crate::services::schedule::suggest_schedule(state, user_id, parsed.date).await?;
            Ok(serde_json::to_string(&resp)?)
        }
        "list_today_overview" => {
            let todos = todos::todos_list(
                state,
                user_id,
                TodosListArgs {
                    include_done: None,
                },
            )
            .await?;
            let events = calendar::calendar_today_events(state, user_id).await?;
            // events는 LLM 컨텍스트 경량화를 위해 브리핑에 필요한 필드만 추림
            // (시작/종료 시각·장소 포함 — 일정 브리핑 표시에 사용).
            let events_lite: Vec<Value> = events
                .iter()
                .map(|e| {
                    json!({
                        "summary": e.summary,
                        "start_at": e.start_at,
                        "end_at": e.end_at,
                        "all_day": e.all_day,
                        "location": e.location,
                    })
                })
                .collect();
            Ok(json!({
                "todos": todos,
                "events": events_lite,
            })
            .to_string())
        }
        // 쓰기 도구는 절대 자동 실행 안 함 — agent loop이 pending tool로 반환해야 함.
        "create_todo"
        | "complete_todo"
        | "delete_todo"
        | "create_event"
        | "update_event"
        | "delete_event"
        | "schedule_commit"
        | "remember_fact" => Err(AppError::InvalidInput(format!(
            "{name}은(는) 자동 실행 도구가 아님 (UI confirm 필요)"
        ))),
        _ => Err(AppError::NotFound(format!("unknown tool: {name}"))),
    }
}

