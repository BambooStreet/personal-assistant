use std::time::Duration;

use chrono::{DateTime, Utc};
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    RedirectUrl, RefreshToken, Scope, TokenResponse, TokenUrl,
};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

const AUTH_URI: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
const CALLBACK_TIMEOUT_SECS: u64 = 300;
const EXPIRES_AT_KEY: &str = "google.access_token_expires_at";
const REFRESH_LEAD_SECS: i64 = 60;

pub async fn start_google_oauth(state: &AppState) -> AppResult<()> {
    let client_id = state
        .secrets
        .get(SecretKey::GoogleClientId)?
        .ok_or_else(|| AppError::Unauthorized("Google client_id가 없습니다".into()))?;
    let client_secret = state
        .secrets
        .get(SecretKey::GoogleClientSecret)?
        .ok_or_else(|| AppError::Unauthorized("Google client_secret이 없습니다".into()))?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Internal(format!("listener bind: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(format!("local_addr: {e}")))?
        .port();
    let redirect = format!("http://127.0.0.1:{port}");

    let auth_url = AuthUrl::new(AUTH_URI.to_string())
        .map_err(|e| AppError::Internal(format!("auth url: {e}")))?;
    let token_url = TokenUrl::new(TOKEN_URI.to_string())
        .map_err(|e| AppError::Internal(format!("token url: {e}")))?;
    let redirect_url = RedirectUrl::new(redirect.clone())
        .map_err(|e| AppError::Internal(format!("redirect url: {e}")))?;

    let client = BasicClient::new(ClientId::new(client_id))
        .set_client_secret(ClientSecret::new(client_secret))
        .set_auth_uri(auth_url)
        .set_token_uri(token_url)
        .set_redirect_uri(redirect_url);

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let (authorize_url, _csrf) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(CALENDAR_SCOPE.to_string()))
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("email".to_string()))
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        .set_pkce_challenge(pkce_challenge)
        .url();

    tracing::info!(redirect = %redirect, "starting Google OAuth");

    // Main에 url을 emit. Main이 allowlist 검증 후 shell.openExternal 처리.
    state.emit("shell.openExternal", json!({ "url": authorize_url.to_string() }));

    let code = tokio::time::timeout(
        Duration::from_secs(CALLBACK_TIMEOUT_SECS),
        wait_for_callback(listener),
    )
    .await
    .map_err(|_| AppError::External("OAuth 콜백 시간 초과".into()))??;

    let http_client = reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AppError::Internal(format!("http client: {e}")))?;

    let token = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http_client)
        .await
        .map_err(|e| AppError::External(format!("토큰 교환 실패: {e}")))?;

    let access = token.access_token().secret().to_string();
    let refresh = token
        .refresh_token()
        .ok_or_else(|| AppError::External("refresh_token이 응답에 없습니다".into()))?
        .secret()
        .to_string();
    let expires_in = token
        .expires_in()
        .map(|d| d.as_secs() as i64)
        .unwrap_or(3600);
    let expires_at = Utc::now() + chrono::Duration::seconds(expires_in);

    state.secrets.set(SecretKey::GoogleAccessToken, &access)?;
    state.secrets.set(SecretKey::GoogleRefreshToken, &refresh)?;
    save_expires_at(&state.db, &expires_at).await?;

    tracing::info!("Google OAuth completed");
    Ok(())
}

pub async fn refresh_access_token(state: &AppState) -> AppResult<String> {
    let client_id = state
        .secrets
        .get(SecretKey::GoogleClientId)?
        .ok_or_else(|| AppError::Unauthorized("client_id 없음".into()))?;
    let client_secret = state
        .secrets
        .get(SecretKey::GoogleClientSecret)?
        .ok_or_else(|| AppError::Unauthorized("client_secret 없음".into()))?;
    let refresh_token = state
        .secrets
        .get(SecretKey::GoogleRefreshToken)?
        .ok_or_else(|| AppError::Unauthorized("refresh_token 없음".into()))?;

    let auth_url = AuthUrl::new(AUTH_URI.to_string())
        .map_err(|e| AppError::Internal(format!("auth url: {e}")))?;
    let token_url = TokenUrl::new(TOKEN_URI.to_string())
        .map_err(|e| AppError::Internal(format!("token url: {e}")))?;

    let client = BasicClient::new(ClientId::new(client_id))
        .set_client_secret(ClientSecret::new(client_secret))
        .set_auth_uri(auth_url)
        .set_token_uri(token_url);

    let http_client = reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AppError::Internal(format!("http client: {e}")))?;

    let token = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token))
        .request_async(&http_client)
        .await
        .map_err(|e| AppError::External(format!("토큰 갱신 실패: {e}")))?;

    let access = token.access_token().secret().to_string();
    let expires_in = token
        .expires_in()
        .map(|d| d.as_secs() as i64)
        .unwrap_or(3600);
    let expires_at = Utc::now() + chrono::Duration::seconds(expires_in);

    if let Some(new_refresh) = token.refresh_token() {
        state
            .secrets
            .set(SecretKey::GoogleRefreshToken, new_refresh.secret())?;
    }
    state.secrets.set(SecretKey::GoogleAccessToken, &access)?;
    save_expires_at(&state.db, &expires_at).await?;

    Ok(access)
}

pub async fn current_access_token(state: &AppState) -> AppResult<String> {
    if !state.secrets.has(SecretKey::GoogleRefreshToken)? {
        return Err(AppError::Unauthorized("Google 연결되지 않음".into()));
    }
    let expires_at = load_expires_at(&state.db).await?;
    let now = Utc::now();
    let need_refresh = expires_at
        .map(|e| (e - now).num_seconds() < REFRESH_LEAD_SECS)
        .unwrap_or(true);

    if need_refresh {
        refresh_access_token(state).await
    } else {
        state
            .secrets
            .get(SecretKey::GoogleAccessToken)?
            .ok_or_else(|| AppError::Unauthorized("access_token 없음".into()))
    }
}

pub async fn disconnect(state: &AppState) -> AppResult<()> {
    // v0: Google 연결은 플랫폼 전역(단일 계정) → 오너(DEFAULT_USER_ID) 스코프로 정리.
    let uid = crate::rpc::DEFAULT_USER_ID;
    state.secrets.delete(SecretKey::GoogleAccessToken)?;
    state.secrets.delete(SecretKey::GoogleRefreshToken)?;
    sqlx::query("DELETE FROM settings WHERE user_id = ? AND key = ?")
        .bind(uid)
        .bind(EXPIRES_AT_KEY)
        .execute(&state.db)
        .await?;
    sqlx::query("DELETE FROM sync_state WHERE user_id = ? AND provider = 'google_calendar'")
        .bind(uid)
        .execute(&state.db)
        .await?;
    Ok(())
}

pub async fn is_connected(state: &AppState) -> AppResult<bool> {
    state.secrets.has(SecretKey::GoogleRefreshToken)
}

async fn save_expires_at(pool: &sqlx::SqlitePool, expires_at: &DateTime<Utc>) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) \
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(crate::rpc::DEFAULT_USER_ID)
    .bind(EXPIRES_AT_KEY)
    .bind(expires_at.to_rfc3339())
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_expires_at(pool: &sqlx::SqlitePool) -> AppResult<Option<DateTime<Utc>>> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE user_id = ? AND key = ?")
            .bind(crate::rpc::DEFAULT_USER_ID)
            .bind(EXPIRES_AT_KEY)
            .fetch_optional(pool)
            .await?;
    Ok(raw.and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    }))
}

async fn wait_for_callback(listener: TcpListener) -> AppResult<String> {
    let (mut socket, _) = listener
        .accept()
        .await
        .map_err(|e| AppError::Internal(format!("accept: {e}")))?;
    let mut buf = vec![0u8; 8192];
    let n = socket
        .read(&mut buf)
        .await
        .map_err(|e| AppError::Internal(format!("read: {e}")))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| AppError::External("잘못된 콜백 요청".into()))?;

    let url = oauth2::url::Url::parse(&format!("http://127.0.0.1{}", path))
        .map_err(|e| AppError::External(format!("url 파싱: {e}")))?;

    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();

    if let Some((_, err)) = pairs.iter().find(|(k, _)| k == "error") {
        let body = error_html(&format!("OAuth 거부됨: {err}"));
        let _ = socket
            .write_all(http_response(&body).as_bytes())
            .await;
        return Err(AppError::External(format!("OAuth 거부: {err}")));
    }

    let code = pairs
        .into_iter()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v)
        .ok_or_else(|| AppError::External("code 파라미터가 없습니다".into()))?;

    let body = success_html();
    let _ = socket.write_all(http_response(&body).as_bytes()).await;
    let _ = socket.flush().await;
    let _ = socket.shutdown().await;
    Ok(code)
}

fn http_response(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    )
}

fn success_html() -> String {
    r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>인증 완료</title></head><body style="font-family:sans-serif;text-align:center;padding:48px;background:#1c1c22;color:#f5f5f8"><h2>✅ 인증 완료</h2><p>이 창을 닫고 위젯으로 돌아가세요.</p></body></html>"#.to_string()
}

fn error_html(msg: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>인증 실패</title></head><body style="font-family:sans-serif;text-align:center;padding:48px;background:#1c1c22;color:#fca5a5"><h2>인증 실패</h2><p>{msg}</p></body></html>"#
    )
}
