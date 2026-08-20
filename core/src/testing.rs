//! DB 테스트 하네스 — 메모리 SQLite + 마이그레이션 + `AppState` 조립.
//!
//! 이걸로 `&AppState`를 받는 진짜 함수(커맨드/서비스)를 테스트할 수 있다. 순수 함수만
//! 검증하던 기존 테스트로는 못 잡던 것들 — 테넌시 격리, 캐스케이드 삭제, 디듑, 이벤트
//! 발화 — 이 대상이다.
//!
//! 새 도메인에서도 그대로 재사용할 것.

use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::mpsc::{self, UnboundedReceiver};

use crate::error::AppResult;
use crate::infra::secrets::{SecretKey, SecretsBackend, SecretsStore};
use crate::state::{AppState, EventMsg};

/// 항상 비어 있는 비밀값 백엔드.
///
/// ⚠️ **이게 하네스의 핵심 안전장치다.** `SecretsStore::new()`는 Windows/macOS에서
/// `KeyringBackend`(실제 OS 자격 증명 저장소)를 고른다. 주입하지 않으면 `cargo test`가
/// 개발 PC의 진짜 OpenAI 키를 찾아 **테스트 중에 실제 API를 호출**한다.
struct EmptySecrets;

impl SecretsBackend for EmptySecrets {
    fn get(&self, _key: SecretKey) -> AppResult<Option<String>> {
        Ok(None)
    }
    fn set(&self, _key: SecretKey, _value: &str) -> AppResult<()> {
        Ok(())
    }
    fn delete(&self, _key: SecretKey) -> AppResult<()> {
        Ok(())
    }
}

/// 빈 메모리 DB + 마이그레이션 전부 적용된 `AppState`.
///
/// 반환하는 `UnboundedReceiver`로 `state.emit(...)`이 실제로 나갔는지 검증한다 —
/// 이걸 떨어뜨리면 채널이 닫히니 테스트 끝까지 들고 있을 것.
pub async fn test_state() -> (AppState, UnboundedReceiver<EventMsg>) {
    // ⚠️ max_connections(1) 필수. `sqlite::memory:`는 **커넥션마다 별개의 DB**라
    // 풀이 2개 이상이면 A에 쓴 걸 B가 못 본다.
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("메모리 DB 연결");

    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("마이그레이션");

    let (tx, rx) = mpsc::unbounded_channel();
    let state = AppState::new_for_test(db, tx, SecretsStore::with_backend(Box::new(EmptySecrets)));
    (state, rx)
}

/// 테넌시 테스트용 추가 유저. `users`에 행이 있어야 스케줄러가 순회한다.
pub async fn add_user(state: &AppState, id: i64, handle: &str) {
    sqlx::query("INSERT INTO users (id, handle, created_at) VALUES (?, ?, '2026-01-01T00:00:00Z')")
        .bind(id)
        .bind(handle)
        .execute(&state.db)
        .await
        .expect("유저 추가");
}

pub async fn set_setting(state: &AppState, user_id: i64, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z') \
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
    )
    .bind(user_id)
    .bind(key)
    .bind(value)
    .execute(&state.db)
    .await
    .expect("설정 저장");
}

pub async fn count(state: &AppState, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(&state.db)
        .await
        .expect("count")
}
