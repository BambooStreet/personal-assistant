pub mod commands;
pub mod error;
pub mod infra;
pub mod services;
pub mod state;

use tauri::Manager;
use tracing_subscriber::{fmt, layer::SubscriberExt, EnvFilter, Registry};

use crate::infra::paths;
use crate::state::AppState;

fn init_tracing(log_dir: &std::path::Path) -> tracing_appender::non_blocking::WorkerGuard {
    let file_appender = tracing_appender::rolling::daily(log_dir, "app.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,hyper=warn,reqwest=warn"));

    let subscriber = Registry::default()
        .with(env_filter)
        .with(fmt::Layer::new().with_writer(std::io::stdout))
        .with(fmt::Layer::new().with_writer(non_blocking).with_ansi(false));

    tracing::subscriber::set_global_default(subscriber).ok();
    guard
}

struct LogGuard(#[allow(dead_code)] tracing_appender::non_blocking::WorkerGuard);

const SYNC_INITIAL_DELAY_SECS: u64 = 30;
const SYNC_INTERVAL_SECS: u64 = 30 * 60;

async fn run_background_sync_once(handle: &tauri::AppHandle) {
    let state = match handle.try_state::<AppState>() {
        Some(s) => s,
        None => return,
    };
    match crate::infra::oauth::is_connected(&state).await {
        Ok(true) => match crate::services::calendar::sync::run_sync(&state).await {
            Ok(report) => tracing::info!(?report, "background calendar sync ok"),
            Err(e) => tracing::warn!(error = %e, "background calendar sync failed"),
        },
        Ok(false) => {} // silent skip when not connected
        Err(e) => tracing::warn!(error = %e, "is_connected check failed"),
    }
}

fn spawn_background_sync(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(SYNC_INITIAL_DELAY_SECS)).await;
        loop {
            run_background_sync_once(&handle).await;
            tokio::time::sleep(std::time::Duration::from_secs(SYNC_INTERVAL_SECS)).await;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let handle = app.handle();
            let log_dir = paths::log_dir(handle).expect("log dir");
            let guard = init_tracing(&log_dir);
            app.manage(LogGuard(guard));

            let handle_for_db = handle.clone();
            let pool = tauri::async_runtime::block_on(async move {
                infra::db::connect(&handle_for_db).await
            })
            .expect("db init");

            tracing::info!(
                version = env!("CARGO_PKG_VERSION"),
                "personal_assistant started"
            );

            app.manage(AppState::new(pool));

            spawn_background_sync(handle.clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::secret_set,
            commands::settings::secret_delete,
            commands::settings::secret_status,
            commands::settings::secret_status_all,
            commands::settings::app_health,
            commands::settings::daily_cap_get,
            commands::settings::daily_cap_set,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::chat::chat_send,
            commands::chat::chat_history,
            commands::chat::chat_clear,
            commands::chat::cost_summary,
            commands::todos::todos_list,
            commands::todos::todos_create,
            commands::todos::todos_complete,
            commands::todos::todos_uncomplete,
            commands::todos::todos_delete,
            commands::window::window_set_hit_region,
            commands::oauth::oauth_google_start,
            commands::oauth::oauth_google_status,
            commands::oauth::oauth_google_disconnect,
            commands::calendar::calendar_today_events,
            commands::calendar::calendar_upcoming_events,
            commands::calendar::calendar_sync_now,
            commands::calendar::calendar_create_event,
            commands::calendar::calendar_delete_event,
            commands::briefing::briefing_today,
            commands::briefing::briefing_run,
            commands::speech::stt_transcribe,
            commands::speech::tts_speak,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
