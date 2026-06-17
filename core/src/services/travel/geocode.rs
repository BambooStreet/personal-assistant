//! 장소 텍스트 → 좌표(lat, lng). alias → geocode_cache → Kakao Local 순. 못 풀면 None.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

use super::pure::{normalize_query, round_coord};

const KAKAO_KEYWORD: &str = "https://dapi.kakao.com/v2/local/search/keyword.json";

/// 좌표는 (lat, lng). 해석 실패 시 Ok(None) — 호출부가 해당 leg를 조용히 skip한다.
#[tracing::instrument(skip(state), fields(user_id))]
pub async fn resolve(state: &AppState, user_id: i64, raw: &str) -> AppResult<Option<(f64, f64)>> {
    // 1) 별칭: 사전 지오코딩된 좌표가 있으면 그대로(사용자 정정 우선), 없으면 alias.query를 지오코딩.
    let query = match lookup_alias(state, user_id, raw).await? {
        Some((_, Some(lat), Some(lng))) => return Ok(Some((round_coord(lat), round_coord(lng)))),
        Some((q, _, _)) => q,
        None => raw.to_string(),
    };
    let q = normalize_query(&query);
    if q.is_empty() {
        return Ok(None);
    }
    // 2) 캐시
    if let Some(c) = cache_get(state, &q).await? {
        return Ok(Some(c));
    }
    // 3) Kakao 호출
    let Some(c) = kakao_keyword(state, &q).await? else {
        return Ok(None);
    };
    cache_put(state, &q, c).await?;
    Ok(Some(c))
}

async fn lookup_alias(
    state: &AppState,
    user_id: i64,
    alias: &str,
) -> AppResult<Option<(String, Option<f64>, Option<f64>)>> {
    let row = sqlx::query_as::<_, (String, Option<f64>, Option<f64>)>(
        "SELECT query, lat, lng FROM place_alias WHERE user_id = ? AND alias = ?",
    )
    .bind(user_id)
    .bind(alias.trim())
    .fetch_optional(&state.db)
    .await?;
    Ok(row)
}

async fn cache_get(state: &AppState, query: &str) -> AppResult<Option<(f64, f64)>> {
    let row = sqlx::query_as::<_, (f64, f64)>(
        "SELECT lat, lng FROM geocode_cache WHERE query = ?",
    )
    .bind(query)
    .fetch_optional(&state.db)
    .await?;
    Ok(row)
}

async fn cache_put(state: &AppState, query: &str, coord: (f64, f64)) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR REPLACE INTO geocode_cache (query, lat, lng, provider, cached_at) \
         VALUES (?, ?, ?, 'kakao', ?)",
    )
    .bind(query)
    .bind(coord.0)
    .bind(coord.1)
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[tracing::instrument(skip(state, query))]
async fn kakao_keyword(state: &AppState, query: &str) -> AppResult<Option<(f64, f64)>> {
    // 키 미설정이면 기능 비활성 — 조용히 None(틱마다 에러 내지 않음).
    let Some(key) = state.secrets.get(SecretKey::KakaoRestApiKey)? else {
        tracing::debug!("Kakao REST 키 미설정 — geocode skip");
        return Ok(None);
    };
    let url = format!("{KAKAO_KEYWORD}?size=1&query={}", urlencoding::encode(query));
    let resp = state
        .http
        .get(&url)
        .header("Authorization", format!("KakaoAK {key}"))
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(AppError::External(format!(
            "Kakao {status}: {}",
            text.chars().take(500).collect::<String>()
        )));
    }
    let parsed: KakaoResponse = serde_json::from_str(&text)?;
    let Some(doc) = parsed.documents.into_iter().next() else {
        return Ok(None); // 검색 결과 0건
    };
    // Kakao 좌표: x=경도(lng), y=위도(lat) — 문자열로 옴.
    let lng: f64 = doc.x.parse().map_err(|_| AppError::External("Kakao x 파싱 실패".into()))?;
    let lat: f64 = doc.y.parse().map_err(|_| AppError::External("Kakao y 파싱 실패".into()))?;
    Ok(Some((round_coord(lat), round_coord(lng))))
}

#[derive(Debug, Deserialize)]
struct KakaoResponse {
    #[serde(default)]
    documents: Vec<KakaoDoc>,
}

#[derive(Debug, Deserialize)]
struct KakaoDoc {
    x: String,
    y: String,
}
