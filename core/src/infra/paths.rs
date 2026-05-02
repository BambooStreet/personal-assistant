use std::path::{Path, PathBuf};

use crate::error::AppResult;

pub fn ensure_dir(p: &Path) -> AppResult<()> {
    if !p.exists() {
        std::fs::create_dir_all(p)?;
    }
    Ok(())
}

pub fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("pa.sqlite")
}

pub fn audio_cache_dir(data_dir: &Path) -> AppResult<PathBuf> {
    let dir = data_dir.join("audio_cache");
    ensure_dir(&dir)?;
    Ok(dir)
}

pub fn log_dir(data_dir: &Path) -> AppResult<PathBuf> {
    let dir = data_dir.join("logs");
    ensure_dir(&dir)?;
    Ok(dir)
}
