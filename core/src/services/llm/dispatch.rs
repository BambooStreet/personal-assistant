use serde_json::{json, Value};

use crate::commands::calendar::{
    self, CreateEventArgs, DeleteEventArgs, UpcomingArgs, UpdateEventArgs,
};
use crate::commands::memory::{self, MemoryRememberArgs, MemorySearchArgs};
use crate::commands::todos::{
    self, TodoDraft, TodosCreateArgs, TodosIdArgs, TodosListArgs, TodosUpdateArgs,
};
use crate::error::{AppError, AppResult};
use crate::services::calendar::{EventDraft, EventPatch};
use crate::services::schedule::{self, CommitArgs};
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
            | "plan_travel"
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
        "plan_travel" => {
            #[derive(serde::Deserialize, Default)]
            struct Args {
                #[serde(default)]
                date: Option<String>,
            }
            let parsed: Args = serde_json::from_value(args).unwrap_or_default();
            let date = parsed
                .date
                .as_deref()
                .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
            let legs = crate::services::travel::plan_travel_for_date(state, user_id, date).await?;
            Ok(serde_json::to_string(&legs)?)
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
            // 장소는 Google 캘린더 원본("POI, 대한민국 전체주소")이 지저분해서
            // clean_label로 짧은 표시용 라벨만 남긴다.
            use crate::services::travel::pure::clean_label;
            let events_lite: Vec<Value> = events
                .iter()
                .map(|e| {
                    let location = e
                        .location
                        .as_deref()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                        .map(clean_label);
                    json!({
                        "summary": e.summary,
                        "start_at": e.start_at,
                        "end_at": e.end_at,
                        "all_day": e.all_day,
                        "location": location,
                    })
                })
                .collect();
            // 표시 형식 지침은 넣지 않는다 — 목록 렌더는 클라이언트(카드/봇 포맷터) 몫이고,
            // 모델에는 chat.rs의 BRIEFING_PRESENT_HINT가 "나열 말고 요약"만 지시한다.
            Ok(json!({
                "todos": todos,
                "events": events_lite,
            })
            .to_string())
        }
        // 쓰기 도구는 자동 실행 안 함 — agent loop이 pending tool로 반환하고,
        // 사용자 승인 후 execute_write_tool로 실행한다.
        "create_todo"
        | "complete_todo"
        | "update_todo"
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

/// 사용자 승인 후 쓰기 도구를 **Core가 직접 실행**한다(4b). 모든 클라이언트(렌더러·텔레그램)는
/// 승인/거절만 보내고 실행/매핑을 복제하지 않는다.
///
/// LLM 툴 인자는 flat이고 커맨드 구조체는 중첩이라 여기서 flat→nested 어댑팅을 한다.
/// (구 렌더러 toolExecutors.ts의 Rust 포팅 — 단일 위치.)
pub async fn execute_write_tool(
    state: &AppState,
    user_id: i64,
    name: &str,
    args: Value,
) -> AppResult<String> {
    match name {
        "create_todo" => {
            // flat {title, notes?, due_at?, priority?, estimated_minutes?, recur?} → draft 래핑
            let draft: TodoDraft = serde_json::from_value(args)?;
            let created = todos::todos_create(state, user_id, TodosCreateArgs { draft }).await?;
            Ok(serde_json::to_string(&created)?)
        }
        "complete_todo" => {
            let a: TodosIdArgs = serde_json::from_value(args)?;
            let updated = todos::todos_complete(state, user_id, a).await?;
            Ok(serde_json::to_string(&updated)?)
        }
        "update_todo" => {
            // 부분 수정: 보내온 필드만 덮고 나머지는 기존 값 유지.
            // (todos_update는 draft 전체 교체라 여기서 병합해 넘긴다.)
            #[derive(serde::Deserialize)]
            struct Patch {
                id: i64,
                #[serde(default)]
                title: Option<String>,
                #[serde(default)]
                notes: Option<String>,
                #[serde(default)]
                due_at: Option<String>,
                #[serde(default)]
                priority: Option<i64>,
                #[serde(default)]
                recur: Option<String>,
                #[serde(default)]
                estimated_minutes: Option<i64>,
            }
            let p: Patch = serde_json::from_value(args)?;
            let cur = todos::todos_get(state, user_id, p.id).await?;
            let draft = TodoDraft {
                title: p.title.unwrap_or(cur.title),
                notes: p.notes.or(cur.notes),
                due_at: p.due_at.or(cur.due_at),
                priority: Some(p.priority.unwrap_or(cur.priority)),
                recur: p.recur.or(cur.recur),
                estimated_minutes: p.estimated_minutes.or(cur.estimated_minutes),
            };
            let updated =
                todos::todos_update(state, user_id, TodosUpdateArgs { id: p.id, draft }).await?;
            Ok(serde_json::to_string(&updated)?)
        }
        "delete_todo" => {
            let a: TodosIdArgs = serde_json::from_value(args)?;
            let id = a.id;
            todos::todos_delete(state, user_id, a).await?;
            Ok(json!({"ok": true, "deleted_id": id}).to_string())
        }
        "create_event" => {
            // flat {summary, start_at, end_at, description?, location?, all_day?} → draft 래핑
            let draft: EventDraft = serde_json::from_value(args)?;
            let created =
                calendar::calendar_create_event(state, user_id, CreateEventArgs { draft }).await?;
            Ok(serde_json::to_string(&created)?)
        }
        "update_event" => {
            // flat {google_event_id, summary?, ...} → {google_event_id, patch=준 필드만}.
            // EventPatch는 google_event_id를 모르므로 역직렬화 시 무시됨(= buildEventPatch).
            #[derive(serde::Deserialize)]
            struct Gid {
                google_event_id: String,
            }
            let gid: Gid = serde_json::from_value(args.clone())?;
            let patch: EventPatch = serde_json::from_value(args)?;
            // 준 필드가 하나도 없으면 거부(구 buildEventPatch 동작 보존).
            if patch.summary.is_none()
                && patch.description.is_none()
                && patch.location.is_none()
                && patch.start_at.is_none()
                && patch.end_at.is_none()
                && patch.all_day.is_none()
            {
                return Err(AppError::InvalidInput("변경할 필드가 없습니다".into()));
            }
            let updated = calendar::calendar_update_event(
                state,
                user_id,
                UpdateEventArgs {
                    google_event_id: gid.google_event_id,
                    patch,
                },
            )
            .await?;
            Ok(serde_json::to_string(&updated)?)
        }
        "delete_event" => {
            let a: DeleteEventArgs = serde_json::from_value(args)?;
            let gid = a.google_event_id.clone();
            calendar::calendar_delete_event(state, user_id, a).await?;
            Ok(json!({"ok": true, "deleted_google_event_id": gid}).to_string())
        }
        "schedule_commit" => {
            let a: CommitArgs = serde_json::from_value(args)?;
            let r = schedule::commit_schedule(state, user_id, a).await?;
            Ok(serde_json::to_string(&r)?)
        }
        "remember_fact" => {
            let a: MemoryRememberArgs = serde_json::from_value(args)?;
            let saved = memory::memory_remember(state, user_id, a).await?;
            Ok(serde_json::to_string(&saved)?)
        }
        _ => Err(AppError::NotFound(format!("unknown write tool: {name}"))),
    }
}

