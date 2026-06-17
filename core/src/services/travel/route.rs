//! 좌표쌍 → 대중교통 이동시간(ODsay). route_cache 우선, 미스면 ODsay 호출 후 캐시.

use chrono::NaiveDateTime;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::infra::secrets::SecretKey;
use crate::state::AppState;

use super::pure::{depart_bucket, route_cache_key};

const ODSAY_PATH: &str = "https://api.odsay.com/v1/api/searchPubTransPathT";
const MODE: &str = "transit";
// 경로 캐시 만료(노선 개편 반영). 조회 시 lazy 만료.
const CACHE_TTL_DAYS: i64 = 7;

#[derive(Debug, Clone)]
pub struct RouteResult {
    pub duration_s: i64,
    pub transfers: i64,
    pub summary_json: String,
}

/// from/to는 (lat, lng). 경로 없음(가까움·대중교통 불가)·키 미설정 시 Ok(None).
#[tracing::instrument(skip(state))]
pub async fn route(
    state: &AppState,
    from: (f64, f64),
    to: (f64, f64),
    depart_local: NaiveDateTime,
) -> AppResult<Option<RouteResult>> {
    let bucket = depart_bucket(depart_local);
    let key = route_cache_key(from, to, &bucket, MODE);

    if let Some(r) = cache_get(state, &key).await? {
        return Ok(Some(r));
    }
    let Some(r) = odsay_call(state, from, to).await? else {
        return Ok(None); // 부정 결과는 캐시하지 않음(일시적 오류와 구분 불가)
    };
    cache_put(state, &key, &r).await?;
    Ok(Some(r))
}

async fn cache_get(state: &AppState, key: &str) -> AppResult<Option<RouteResult>> {
    let row = sqlx::query_as::<_, (i64, i64, String, String)>(
        "SELECT duration_s, transfers, summary_json, cached_at FROM route_cache WHERE cache_key = ?",
    )
    .bind(key)
    .fetch_optional(&state.db)
    .await?;
    let Some((duration_s, transfers, summary_json, cached_at)) = row else {
        return Ok(None);
    };
    // lazy TTL 만료
    if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&cached_at) {
        let age = chrono::Utc::now() - ts.with_timezone(&chrono::Utc);
        if age > chrono::Duration::days(CACHE_TTL_DAYS) {
            return Ok(None);
        }
    }
    Ok(Some(RouteResult {
        duration_s,
        transfers,
        summary_json,
    }))
}

async fn cache_put(state: &AppState, key: &str, r: &RouteResult) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR REPLACE INTO route_cache (cache_key, duration_s, transfers, summary_json, cached_at) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(key)
    .bind(r.duration_s)
    .bind(r.transfers)
    .bind(&r.summary_json)
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[tracing::instrument(skip(state))]
async fn odsay_call(
    state: &AppState,
    from: (f64, f64),
    to: (f64, f64),
) -> AppResult<Option<RouteResult>> {
    let Some(key) = state.secrets.get(SecretKey::OdsayApiKey)? else {
        tracing::debug!("ODsay 키 미설정 — route skip");
        return Ok(None);
    };
    // ODsay 좌표: SX=출발 경도(x), SY=출발 위도(y), EX/EY=도착. from/to는 (lat, lng).
    let url = format!(
        "{ODSAY_PATH}?SX={}&SY={}&EX={}&EY={}&apiKey={}",
        from.1,
        from.0,
        to.1,
        to.0,
        urlencoding::encode(&key)
    );
    let resp = state.http.get(&url).send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(AppError::External(format!(
            "ODsay {status}: {}",
            text.chars().take(500).collect::<String>()
        )));
    }
    let parsed: OdsayResponse = serde_json::from_str(&text)?;
    // error 블록(경로 없음/가까움/한도초과 등) → None으로 degrade.
    if parsed.error.is_some() {
        return Ok(None);
    }
    let Some(path) = parsed.result.and_then(|r| r.path.into_iter().next()) else {
        return Ok(None);
    };
    let info = path.info;
    let transfers = (info.bus_transit_count + info.subway_transit_count - 1).max(0);
    let summary_json = serde_json::to_string(&info).unwrap_or_default();
    Ok(Some(RouteResult {
        duration_s: info.total_time * 60,
        transfers,
        summary_json,
    }))
}

#[derive(Debug, Deserialize)]
struct OdsayResponse {
    #[serde(default)]
    result: Option<OdsayResult>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct OdsayResult {
    #[serde(default)]
    path: Vec<OdsayPath>,
}

#[derive(Debug, Deserialize)]
struct OdsayPath {
    info: OdsayInfo,
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct OdsayInfo {
    #[serde(rename = "totalTime", default)]
    total_time: i64,
    #[serde(rename = "busTransitCount", default)]
    bus_transit_count: i64,
    #[serde(rename = "subwayTransitCount", default)]
    subway_transit_count: i64,
    #[serde(rename = "totalWalk", default)]
    total_walk: i64,
    #[serde(rename = "payment", default)]
    payment: i64,
}
