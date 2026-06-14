use crate::error::AppResult;

// keyring service 이름(Windows/macOS 자격 증명 저장소).
#[cfg(any(target_os = "windows", target_os = "macos"))]
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
    /// keyring account 이름 / 파일 백엔드 JSON 키.
    pub fn account(self) -> &'static str {
        match self {
            SecretKey::OpenAiApiKey => "openai.api_key",
            SecretKey::GoogleClientId => "google.client_id",
            SecretKey::GoogleClientSecret => "google.client_secret",
            SecretKey::GoogleAccessToken => "google.access_token",
            SecretKey::GoogleRefreshToken => "google.refresh_token",
        }
    }

    /// 파일 백엔드(클라우드/Linux)에서 부트스트랩 주입용 환경변수 이름.
    /// access token은 주입 대상 아님(1시간짜리, refresh로 재발급되어 파일에 set됨).
    pub fn env_var(self) -> &'static str {
        match self {
            SecretKey::OpenAiApiKey => "PA_SECRET_OPENAI_API_KEY",
            SecretKey::GoogleClientId => "PA_SECRET_GOOGLE_CLIENT_ID",
            SecretKey::GoogleClientSecret => "PA_SECRET_GOOGLE_CLIENT_SECRET",
            SecretKey::GoogleAccessToken => "PA_SECRET_GOOGLE_ACCESS_TOKEN",
            SecretKey::GoogleRefreshToken => "PA_SECRET_GOOGLE_REFRESH_TOKEN",
        }
    }
}

/// 비밀값 저장 백엔드. 데스크톱은 OS 키체인(KeyringBackend),
/// 클라우드/Linux는 파일+환경변수(FileBackend)를 쓴다. 호출부는 백엔드를 모른다.
pub trait SecretsBackend: Send + Sync {
    fn get(&self, key: SecretKey) -> AppResult<Option<String>>;
    fn set(&self, key: SecretKey, value: &str) -> AppResult<()>;
    fn delete(&self, key: SecretKey) -> AppResult<()>;
}

/// 비밀값 저장소. 공개 API(get/set/delete/has/masked_preview)는 유지하고
/// 실제 저장은 플랫폼별 백엔드에 위임한다. `mask()`는 여기 단일 위치에만 존재.
pub struct SecretsStore {
    backend: Box<dyn SecretsBackend>,
}

impl SecretsStore {
    pub fn new() -> Self {
        Self {
            backend: default_backend(),
        }
    }

    /// 임의 백엔드로 생성(테스트/특수 배치용).
    pub fn with_backend(backend: Box<dyn SecretsBackend>) -> Self {
        Self { backend }
    }

    pub fn set(&self, key: SecretKey, value: &str) -> AppResult<()> {
        self.backend.set(key, value)
    }

    pub fn get(&self, key: SecretKey) -> AppResult<Option<String>> {
        self.backend.get(key)
    }

    pub fn delete(&self, key: SecretKey) -> AppResult<()> {
        self.backend.delete(key)
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

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn default_backend() -> Box<dyn SecretsBackend> {
    Box::new(KeyringBackend)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn default_backend() -> Box<dyn SecretsBackend> {
    Box::new(FileBackend::from_env())
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

// ── 데스크톱 백엔드: OS 키체인 ────────────────────────────────────────────────
#[cfg(any(target_os = "windows", target_os = "macos"))]
struct KeyringBackend;

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl KeyringBackend {
    fn entry(key: SecretKey) -> AppResult<keyring::Entry> {
        keyring::Entry::new(SERVICE, key.account()).map_err(crate::error::AppError::from)
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl SecretsBackend for KeyringBackend {
    fn get(&self, key: SecretKey) -> AppResult<Option<String>> {
        match Self::entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(crate::error::AppError::from(e)),
        }
    }

    fn set(&self, key: SecretKey, value: &str) -> AppResult<()> {
        Self::entry(key)?.set_password(value)?;
        Ok(())
    }

    fn delete(&self, key: SecretKey) -> AppResult<()> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(crate::error::AppError::from(e)),
        }
    }
}

// ── 클라우드/Linux 백엔드: 파일 + 환경변수 ───────────────────────────────────
// get: 파일 우선 → 환경변수 폴백(부트스트랩 주입값). set/delete: 파일만.
// 환경변수는 불변 부트스트랩, 파일은 가변 저장소(refresh로 재발급된 토큰 영속).
// 항상 컴파일됨(테스트 가능). 선택은 default_backend()의 cfg가 담당.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct FileBackend {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl FileBackend {
    /// 파일 경로 해석: `PA_SECRETS_FILE` → `{PA_DATA_DIR}/secrets.json` → `./pa-secrets.json`.
    pub fn from_env() -> Self {
        let path = std::env::var_os("PA_SECRETS_FILE")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("PA_DATA_DIR").map(|d| PathBuf::from(d).join("secrets.json"))
            })
            .unwrap_or_else(|| PathBuf::from("pa-secrets.json"));
        Self::at(path)
    }

    pub fn at(path: PathBuf) -> Self {
        Self {
            path,
            write_lock: Mutex::new(()),
        }
    }

    fn read_map(&self) -> AppResult<BTreeMap<String, String>> {
        match std::fs::read(&self.path) {
            Ok(bytes) => {
                if bytes.is_empty() {
                    return Ok(BTreeMap::new());
                }
                Ok(serde_json::from_slice(&bytes)?)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(e.into()),
        }
    }

    fn write_map(&self, map: &BTreeMap<String, String>) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let json = serde_json::to_vec_pretty(map)?;
        // temp + rename으로 부분 기록 방지.
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, &json)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

impl SecretsBackend for FileBackend {
    fn get(&self, key: SecretKey) -> AppResult<Option<String>> {
        if let Some(v) = self.read_map()?.get(key.account()) {
            return Ok(Some(v.clone()));
        }
        // 파일에 없으면 환경변수(부트스트랩) 폴백.
        Ok(std::env::var(key.env_var())
            .ok()
            .filter(|s| !s.is_empty()))
    }

    fn set(&self, key: SecretKey, value: &str) -> AppResult<()> {
        let _guard = self.write_lock.lock().unwrap();
        let mut map = self.read_map()?;
        map.insert(key.account().to_string(), value.to_string());
        self.write_map(&map)
    }

    fn delete(&self, key: SecretKey) -> AppResult<()> {
        // 파일에서만 제거. 환경변수 주입값은 배포 측(예: fly secrets unset)에서 제거.
        let _guard = self.write_lock.lock().unwrap();
        let mut map = self.read_map()?;
        if map.remove(key.account()).is_some() {
            self.write_map(&map)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_short_and_long() {
        assert_eq!(mask("abc"), "••••"); // n<=8 → 최소 4개
        assert_eq!(mask("12345678"), "••••••••"); // n==8
        assert_eq!(mask("sk-abcdefghij"), "sk-•••ghij"); // head3 + ••• + tail4
    }

    // env(프로세스 전역)를 건드리므로 단일 테스트로 직렬화 — 병렬 테스트 간 env 누수 방지.
    #[test]
    fn file_backend_roundtrip_and_env_precedence() {
        let path =
            std::env::temp_dir().join(format!("pa_secrets_rt_{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        // 이 테스트가 만지는 env 키들을 깨끗한 상태로.
        std::env::remove_var(SecretKey::OpenAiApiKey.env_var());
        std::env::remove_var(SecretKey::GoogleRefreshToken.env_var());
        let be = FileBackend::at(path.clone());

        // 파일 set/get/delete 라운드트립
        assert_eq!(be.get(SecretKey::GoogleRefreshToken).unwrap(), None);
        be.set(SecretKey::GoogleRefreshToken, "tok-123").unwrap();
        assert_eq!(
            be.get(SecretKey::GoogleRefreshToken).unwrap().as_deref(),
            Some("tok-123")
        );
        assert_eq!(be.get(SecretKey::OpenAiApiKey).unwrap(), None); // 다른 키 영향 없음
        be.delete(SecretKey::GoogleRefreshToken).unwrap();
        assert_eq!(be.get(SecretKey::GoogleRefreshToken).unwrap(), None);

        // 환경변수 폴백 + 파일 우선
        std::env::set_var(SecretKey::OpenAiApiKey.env_var(), "env-key");
        assert_eq!(
            be.get(SecretKey::OpenAiApiKey).unwrap().as_deref(),
            Some("env-key")
        );
        be.set(SecretKey::OpenAiApiKey, "file-key").unwrap();
        assert_eq!(
            be.get(SecretKey::OpenAiApiKey).unwrap().as_deref(),
            Some("file-key")
        );

        std::env::remove_var(SecretKey::OpenAiApiKey.env_var());
        let _ = std::fs::remove_file(&path);
    }
}
