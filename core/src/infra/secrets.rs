use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "dev.ohmyhong.personalassistant";

#[derive(Clone, Copy, Debug)]
pub enum SecretKey {
    OpenAiApiKey,
    GoogleClientId,
    GoogleClientSecret,
    GoogleAccessToken,
    GoogleRefreshToken,
}

impl SecretKey {
    pub fn account(self) -> &'static str {
        match self {
            SecretKey::OpenAiApiKey => "openai.api_key",
            SecretKey::GoogleClientId => "google.client_id",
            SecretKey::GoogleClientSecret => "google.client_secret",
            SecretKey::GoogleAccessToken => "google.access_token",
            SecretKey::GoogleRefreshToken => "google.refresh_token",
        }
    }
}

pub struct SecretsStore;

impl SecretsStore {
    pub fn new() -> Self {
        Self
    }

    fn entry(key: SecretKey) -> AppResult<Entry> {
        Entry::new(SERVICE, key.account()).map_err(AppError::from)
    }

    pub fn set(&self, key: SecretKey, value: &str) -> AppResult<()> {
        Self::entry(key)?.set_password(value)?;
        Ok(())
    }

    pub fn get(&self, key: SecretKey) -> AppResult<Option<String>> {
        match Self::entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::from(e)),
        }
    }

    pub fn delete(&self, key: SecretKey) -> AppResult<()> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::from(e)),
        }
    }

    pub fn has(&self, key: SecretKey) -> AppResult<bool> {
        Ok(self.get(key)?.is_some())
    }

    pub fn masked_preview(&self, key: SecretKey) -> AppResult<Option<String>> {
        Ok(self.get(key)?.map(|v| mask(&v)))
    }
}

impl Default for SecretsStore {
    fn default() -> Self {
        Self::new()
    }
}

fn mask(value: &str) -> String {
    let n = value.chars().count();
    if n <= 8 {
        return "•".repeat(n.max(4));
    }
    let head: String = value.chars().take(3).collect();
    let tail: String = value.chars().skip(n - 4).collect();
    format!("{head}•••{tail}")
}
