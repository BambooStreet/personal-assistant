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
