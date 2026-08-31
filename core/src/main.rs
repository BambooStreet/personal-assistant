mod commands;
mod error;
mod infra;
mod rpc;
mod services;
mod state;
#[cfg(test)]
mod testing;

use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};
use tracing_subscriber::{fmt, layer::SubscriberExt, EnvFilter, Registry};

use crate::error::{AppError, AppResult};
use crate::rpc::{RpcRequest, RpcResponse};
use crate::state::{AppState, EventMsg};

const SYNC_INITIAL_DELAY_SECS: u64 = 30;
const SYNC_INTERVAL_SECS: u64 = 30 * 60;

#[derive(Parser, Debug)]
#[command(name = "pa-core", version, about = "Personal Assistant core sidecar")]
struct Args {
    #[arg(long)]
    data_dir: PathBuf,

    #[arg(long)]
    log_dir: Option<PathBuf>,

    /// 로컬 전용 마이그레이션 도구(클라우드 이식). 키체인의 비밀값을 PA_SECRET_*=값 형태로
    /// stdout에 출력하고 종료. 네트워크 노출 아님 — 오너가 본인 머신에서 1회 실행.
    /// 예) fly secrets import < (pa-core --data-dir . --export-secrets)
    #[arg(long)]
    export_secrets: bool,
}

fn init_tracing(log_dir: &std::path::Path) -> tracing_appender::non_blocking::WorkerGuard {
    let file_appender = tracing_appender::rolling::daily(log_dir, "core.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,hyper=warn,reqwest=warn"));

    let subscriber = Registry::default()
        .with(env_filter)
        .with(fmt::Layer::new().with_writer(std::io::stderr))
        .with(fmt::Layer::new().with_writer(non_blocking).with_ansi(false));

    tracing::subscriber::set_global_default(subscriber).ok();
    guard
}

type StdoutMutex = Arc<Mutex<tokio::io::Stdout>>;

async fn write_message(stdout: &StdoutMutex, value: &Value) {
    let line = match serde_json::to_string(value) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[core] failed to serialize message: {e}");
            return;
        }
    };
    let mut guard = stdout.lock().await;
    if let Err(e) = guard.write_all(line.as_bytes()).await {
        eprintln!("[core] stdout write failed: {e}");
        return;
    }
    if let Err(e) = guard.write_all(b"\n").await {
        eprintln!("[core] stdout newline failed: {e}");
        return;
    }
    if let Err(e) = guard.flush().await {
        eprintln!("[core] stdout flush failed: {e}");
    }
}

async fn dispatch(
    state: &AppState,
    user_id: i64,
    method: &str,
    params: Value,
) -> AppResult<Value> {
    match method {
        "app.health" => {
            let r = commands::settings::app_health(state).await?;
            Ok(serde_json::to_value(r)?)
        }
        "secret.set" => {
            let args = serde_json::from_value(params)?;
            commands::settings::secret_set(state, args).await?;
            Ok(Value::Null)
        }
        "secret.delete" => {
            let args = serde_json::from_value(params)?;
            commands::settings::secret_delete(state, args).await?;
            Ok(Value::Null)
        }
        "secret.status" => {
            let args = serde_json::from_value(params)?;
            let r = commands::settings::secret_status(state, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "secret.statusAll" => {
            let r = commands::settings::secret_status_all(state).await?;
            Ok(serde_json::to_value(r)?)
        }
        "settings.dailyCapGet" => {
            let r = commands::settings::daily_cap_get(state, user_id).await?;
            Ok(serde_json::to_value(r)?)
        }
        "settings.dailyCapSet" => {
            let args = serde_json::from_value(params)?;
            commands::settings::daily_cap_set(state, user_id, args).await?;
            Ok(Value::Null)
        }
        "settings.get" => {
            let args = serde_json::from_value(params)?;
            let r = commands::settings::settings_get(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "settings.set" => {
            let args = serde_json::from_value(params)?;
            commands::settings::settings_set(state, user_id, args).await?;
            Ok(Value::Null)
        }
        "chat.send" => {
            let args = serde_json::from_value(params)?;
            let r = commands::chat::chat_send(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "chat.continue" => {
            let args = serde_json::from_value(params)?;
            let r = commands::chat::chat_continue(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "chat.history" => {
            let args = serde_json::from_value(params)?;
            let r = commands::chat::chat_history(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "chat.clear" => {
            let args = serde_json::from_value(params)?;
            let r = commands::chat::chat_clear(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "chat.costSummary" => {
            let r = commands::chat::cost_summary(state, user_id).await?;
            Ok(serde_json::to_value(r)?)
        }
        "todos.list" => {
            let args = serde_json::from_value(params)?;
            let r = commands::todos::todos_list(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "todos.create" => {
            let args = serde_json::from_value(params)?;
            let r = commands::todos::todos_create(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "todos.update" => {
            let args = serde_json::from_value(params)?;
            let r = commands::todos::todos_update(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "todos.complete" => {
            let args = serde_json::from_value(params)?;
            let r = commands::todos::todos_complete(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "todos.uncomplete" => {
            let args = serde_json::from_value(params)?;
            let r = commands::todos::todos_uncomplete(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "todos.delete" => {
            let args = serde_json::from_value(params)?;
            commands::todos::todos_delete(state, user_id, args).await?;
            Ok(Value::Null)
        }
        "goals.list" => {
            let r = commands::goals::goals_list(state, user_id).await?;
            Ok(serde_json::to_value(r)?)
        }
        "goals.create" => {
            let args = serde_json::from_value(params)?;
            let r = commands::goals::goals_create(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "goals.update" => {
            let args = serde_json::from_value(params)?;
            let r = commands::goals::goals_update(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "goals.delete" => {
            let args = serde_json::from_value(params)?;
            commands::goals::goals_delete(state, user_id, args).await?;
            Ok(Value::Null)
        }
        "goals.milestoneToggle" => {
            let args = serde_json::from_value(params)?;
            let r = commands::goals::goals_milestone_toggle(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "goals.routineCreate" => {
            let args = serde_json::from_value(params)?;
            let r = commands::goals::goals_routine_create(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "goals.routineUpdate" => {
            let args = serde_json::from_value(params)?;
            let r = commands::goals::goals_routine_update(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "goals.routineDelete" => {
            let args = serde_json::from_value(params)?;
            commands::goals::goals_routine_delete(state, user_id, args).await?;
            Ok(Value::Null)
        }
        // OAuth/Google 연결은 v0에서 플랫폼 전역(단일 계정) — user_id 비관여.
        "oauth.googleStart" => {
            let r = commands::oauth::oauth_google_start(state).await?;
            Ok(serde_json::to_value(r)?)
        }
        "oauth.googleStatus" => {
            let r = commands::oauth::oauth_google_status(state).await?;
            Ok(serde_json::to_value(r)?)
        }
        "oauth.googleDisconnect" => {
            commands::oauth::oauth_google_disconnect(state).await?;
            Ok(Value::Null)
        }
        "calendar.today" => {
            let r = commands::calendar::calendar_today_events(state, user_id).await?;
            Ok(serde_json::to_value(r)?)
        }
        "calendar.upcoming" => {
            let args = serde_json::from_value(params)?;
            let r = commands::calendar::calendar_upcoming_events(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "calendar.range" => {
            let args = serde_json::from_value(params)?;
            let r = commands::calendar::calendar_range_events(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "calendar.syncNow" => {
            let r = commands::calendar::calendar_sync_now(state, user_id).await?;
            Ok(serde_json::to_value(r)?)
        }
        "calendar.create" => {
            let args = serde_json::from_value(params)?;
            let r = commands::calendar::calendar_create_event(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "calendar.update" => {
            let args = serde_json::from_value(params)?;
            let r = commands::calendar::calendar_update_event(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "calendar.delete" => {
            let args = serde_json::from_value(params)?;
            commands::calendar::calendar_delete_event(state, user_id, args).await?;
            Ok(Value::Null)
        }
        "schedule.commit" => {
            let args = serde_json::from_value(params)?;
            let r = crate::services::schedule::commit_schedule(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "travel.aliasList" => {
            let r = commands::travel::travel_alias_list(state, user_id).await?;
            Ok(serde_json::to_value(r)?)
        }
        "travel.aliasSet" => {
            let args = serde_json::from_value(params)?;
            let r = commands::travel::travel_alias_set(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "travel.aliasDelete" => {
            let args = serde_json::from_value(params)?;
            commands::travel::travel_alias_delete(state, user_id, args).await?;
            Ok(Value::Null)
        }
        "travel.today" => {
            let r = commands::travel::travel_today(state, user_id).await?;
            Ok(serde_json::to_value(r)?)
        }
        "memory.remember" => {
            let args = serde_json::from_value(params)?;
            let r = commands::memory::memory_remember(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "memory.search" => {
            let args = serde_json::from_value(params)?;
            let r = commands::memory::memory_search(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "briefing.today" => {
            let r = commands::briefing::briefing_today(state, user_id).await?;
            Ok(serde_json::to_value(r)?)
        }
        "briefing.run" => {
            let args = serde_json::from_value(params)?;
            let r = commands::briefing::briefing_run(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "greeting.run" => {
            let args = serde_json::from_value(params)?;
            let r = commands::greeting::greeting_run(state, user_id, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "speech.transcribe" => {
            let args = serde_json::from_value(params)?;
            let r = commands::speech::stt_transcribe(state, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "speech.speak" => {
            let args = serde_json::from_value(params)?;
            let r = commands::speech::tts_speak(state, args).await?;
            Ok(serde_json::to_value(r)?)
        }
        "shutdown" => Ok(Value::Null),
        _ => Err(AppError::NotFound(format!("method: {method}"))),
    }
}

async fn run_background_sync_loop(state: Arc<AppState>) {
    tokio::time::sleep(std::time::Duration::from_secs(SYNC_INITIAL_DELAY_SECS)).await;
    loop {
        // Google 연결은 v0에서 플랫폼 전역(단일 계정) → 연결돼 있을 때만 유저별 동기화.
        match crate::infra::oauth::is_connected(&state).await {
            Ok(true) => {
                let uids: Vec<i64> = sqlx::query_scalar("SELECT id FROM users")
                    .fetch_all(&state.db)
                    .await
                    .unwrap_or_default();
                for uid in uids {
                    match crate::services::calendar::sync::run_sync(&state, uid).await {
                        Ok(report) => {
                            tracing::info!(user_id = uid, ?report, "background calendar sync ok");
                            state.emit(
                                "calendar.synced",
                                serde_json::to_value(&report).unwrap_or(Value::Null),
                            );
                        }
                        Err(e) => {
                            tracing::warn!(user_id = uid, error = %e, "background calendar sync failed")
                        }
                    }
                }
            }
            Ok(false) => {}
            Err(e) => tracing::warn!(error = %e, "is_connected check failed"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(SYNC_INTERVAL_SECS)).await;
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // 마이그레이션 export: 서버를 띄우지 않고 비밀값만 출력 후 종료(로컬 전용).
    if args.export_secrets {
        use crate::infra::secrets::{SecretKey, SecretsStore};
        let store = SecretsStore::new();
        for key in [
            SecretKey::OpenAiApiKey,
            SecretKey::GoogleClientId,
            SecretKey::GoogleClientSecret,
            SecretKey::GoogleRefreshToken,
        ] {
            if let Some(v) = store.get(key)? {
                println!("{}={}", key.env_var(), v);
            }
        }
        return Ok(());
    }

    let log_dir = args.log_dir.unwrap_or_else(|| args.data_dir.join("logs"));
    infra::paths::ensure_dir(&log_dir).ok();
    let _guard = init_tracing(&log_dir);
    // LangSmith trace export(옵인). feature off거나 LANGSMITH_API_KEY 없으면 no-op.
    infra::telemetry::init();

    tracing::info!(version = env!("CARGO_PKG_VERSION"), data_dir = %args.data_dir.display(), "pa-core starting");

    // FileBackend(클라우드 secrets)가 data_dir을 일관되게 찾도록 env에 노출.
    // --data-dir과 PA_DATA_DIR이 어긋나지 않게 args 기준으로 세팅(이미 있으면 덮어씀).
    std::env::set_var("PA_DATA_DIR", &args.data_dir);

    let pool = infra::db::connect(&args.data_dir).await?;

    // event channel: services → main → stdout
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<EventMsg>();
    let state = Arc::new(AppState::new(pool, event_tx));
    tracing::info!("db ready");

    let stdout: StdoutMutex = Arc::new(Mutex::new(tokio::io::stdout()));

    // event writer task
    let writer_stdout = stdout.clone();
    tokio::spawn(async move {
        while let Some(msg) = event_rx.recv().await {
            let notif = json!({
                "jsonrpc": "2.0",
                "method": "event",
                "params": { "name": msg.name, "data": msg.data },
            });
            write_message(&writer_stdout, &notif).await;
        }
    });

    // 시작 알림
    state.emit(
        "core.ready",
        json!({ "version": env!("CARGO_PKG_VERSION") }),
    );

    // 30분 polling 백그라운드 task
    let bg_state = state.clone();
    tokio::spawn(run_background_sync_loop(bg_state));

    // 1분 tick 알림 스케줄러
    let notif_state = state.clone();
    tokio::spawn(services::notifications::run_scheduler_loop(notif_state));

    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let stdout_clone = stdout.clone();
        let state_clone = state.clone();

        tokio::spawn(async move {
            let req: RpcRequest = match serde_json::from_str(&line) {
                Ok(r) => r,
                Err(e) => {
                    let resp = RpcResponse::parse_error(
                        Value::Null,
                        format!("invalid JSON-RPC: {e}"),
                    );
                    write_message(&stdout_clone, &serde_json::to_value(&resp).unwrap()).await;
                    return;
                }
            };

            let id = req.id.clone().unwrap_or(Value::Null);
            let is_shutdown = req.method == "shutdown";

            let resp = match dispatch(&state_clone, req.user_id, &req.method, req.params).await {
                Ok(v) => RpcResponse::success(id.clone(), v),
                Err(AppError::NotFound(msg)) if msg.starts_with("method:") => {
                    RpcResponse::method_not_found(id.clone(), &req.method)
                }
                Err(e) => {
                    tracing::warn!(method = %req.method, error = %e, "rpc handler error");
                    RpcResponse::error(id.clone(), e)
                }
            };
            write_message(&stdout_clone, &serde_json::to_value(&resp).unwrap()).await;

            if is_shutdown {
                tracing::info!("shutdown requested");
                infra::telemetry::shutdown(); // 배치된 trace flush 후 종료
                std::process::exit(0);
            }
        });
    }

    tracing::info!("stdin closed, exiting");
    infra::telemetry::shutdown();
    Ok(())
}
