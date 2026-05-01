use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub fn app_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app_data_dir: {e}")))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

pub fn db_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app_data_dir(app)?.join("pa.sqlite"))
}

pub fn audio_cache_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app_data_dir(app)?.join("audio_cache");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

pub fn log_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app_data_dir(app)?.join("logs");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}
