//! 일정 사이 이동시간 계산(D-018 v1). 지오코딩=Kakao, 경로=ODsay(대중교통).
//! 출발지는 직전 일정 장소, 없으면 travel.home. 외부 호출은 캐시 우선.

mod geocode;
pub mod pure;
mod route;

use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use serde::Serialize;
use sqlx::Row;

use crate::error::AppResult;
use crate::state::AppState;

use pure::{clean_label, depart_by, normalize_query, resolve_origin, EvLite, Origin};

// 직전 일정 ~ 대상 시작 간극이 이걸 넘으면 그 사이 집에 들렀다고 보고 home 폴백.
const MAX_ORIGIN_GAP_MIN: i64 = 240; // 4h
const DEFAULT_BUFFER_MIN: i64 = 10;
const MODE: &str = "transit";

/// 한 이벤트로의 이동 구간.
#[derive(Debug, Clone, Serialize)]
pub struct Leg {
    pub event_id: i64,
    pub summary: String,
    pub from: String,
    pub to: String,
    pub start_at: String,  // 이벤트 시작(UTC RFC3339)
    pub depart_by: String, // 출발 시각(UTC RFC3339)
    pub duration_min: i64,
    pub transfers: i64,
    pub mode: String,
    /// 사람이 읽는 환승 경로 (예: "수인분당선 서현→선릉 / 2호선 선릉→강남").
    pub route_detail: String,
}

struct Ev {
    id: i64,
    summary: String,
    location: Option<String>,
    start_at: String,
    end_at: String,
    all_day: bool,
}

/// 장소 텍스트를 좌표로 해석(별칭 등록 시 사전 지오코딩용). 못 풀면 Ok(None).
pub async fn geocode_text(
    state: &AppState,
    user_id: i64,
    query: &str,
) -> AppResult<Option<(f64, f64)>> {
    geocode::resolve(state, user_id, query).await
}

/// 오늘 일정 동선(조회/표시용). plan_travel_for_date(None)와 동일.
pub async fn plan_today_travel(state: &AppState, user_id: i64) -> AppResult<Vec<Leg>> {
    plan_travel_for_date(state, user_id, None).await
}

/// 지정 날짜(None=오늘)의 일정 동선. 집(또는 직전 일정 장소)에서 각 일정까지의 leg.
pub async fn plan_travel_for_date(
    state: &AppState,
    user_id: i64,
    date: Option<NaiveDate>,
) -> AppResult<Vec<Leg>> {
    let day = date.unwrap_or_else(|| Local::now().date_naive());
    let (day_start, day_end) = local_day_bounds_utc(day);
    let events = load_events(state, user_id, &day_start, &day_end).await?;
    let from = parse_utc(&day_start);
    let to = parse_utc(&day_end);
    compute_legs(state, user_id, &events, from, to).await
}

/// 다음 window_hours 이내 시작하는 이벤트의 이동 구간(출발 알림용).
/// 출발지 추론을 위해 오늘 자정부터의 이벤트를 함께 로드한다.
pub async fn legs_in_window(
    state: &AppState,
    user_id: i64,
    window_hours: i64,
) -> AppResult<Vec<Leg>> {
    let now = Utc::now();
    let (day_start, _) = local_day_bounds_utc(Local::now().date_naive());
    let win_end = (now + Duration::hours(window_hours)).to_rfc3339();
    let events = load_events(state, user_id, &day_start, &win_end).await?;
    compute_legs(state, user_id, &events, Some(now), parse_utc(&win_end)).await
}

/// all_events 중 [targets_from, targets_to]에 시작하는 이벤트마다 leg 계산.
/// 출발지 추론은 all_events 전체(직전 일정 포함)를 본다.
async fn compute_legs(
    state: &AppState,
    user_id: i64,
    all_events: &[Ev],
    targets_from: Option<DateTime<Utc>>,
    targets_to: Option<DateTime<Utc>>,
) -> AppResult<Vec<Leg>> {
    let buffer_min = read_buffer_min(state, user_id).await;
    let home = read_home(state, user_id).await;

    // 출발지 추론용 경량 리스트(파싱 실패 이벤트는 None 자리로 두되 인덱스는 보존).
    let lites: Vec<Option<EvLite>> = all_events
        .iter()
        .map(|e| {
            Some(EvLite {
                start: parse_utc(&e.start_at)?,
                end: parse_utc(&e.end_at)?,
                all_day: e.all_day,
                location: e.location.clone(),
            })
        })
        .collect();
    let evlites: Vec<EvLite> = lites.iter().flatten().cloned().collect();
    // evlites는 파싱 성공분만 → 인덱스 매핑을 위해 같은 필터를 타깃 루프에도 적용.

    let mut legs = Vec::new();
    let mut li = 0usize; // evlites 인덱스
    for e in all_events.iter() {
        let Some(start) = parse_utc(&e.start_at) else {
            continue; // 파싱 실패는 evlites에도 없음 → li 증가 안 함
        };
        let idx = li;
        li += 1;

        if e.all_day {
            continue;
        }
        let Some(loc) = e.location.as_deref().filter(|l| !l.trim().is_empty()) else {
            continue;
        };
        if let Some(f) = targets_from {
            if start < f {
                continue;
            }
        }
        if let Some(t) = targets_to {
            if start > t {
                continue;
            }
        }

        // 출발지 결정
        let origin_query = match resolve_origin(&evlites, idx, MAX_ORIGIN_GAP_MIN) {
            Origin::Prev(p) => p,
            Origin::Home => {
                if home.trim().is_empty() {
                    continue; // home 미설정 → 조용히 skip
                }
                home.clone()
            }
        };
        // 같은 장소면 이동 없음
        if normalize_query(&origin_query) == normalize_query(loc) {
            continue;
        }

        // 지오코딩(둘 중 하나라도 실패하면 skip + warn)
        let from = match geocode::resolve(state, user_id, &origin_query).await? {
            Some(c) => c,
            None => {
                tracing::warn!(event_id = e.id, origin = %origin_query, "출발지 지오코딩 실패 — leg skip");
                continue;
            }
        };
        let to = match geocode::resolve(state, user_id, loc).await? {
            Some(c) => c,
            None => {
                tracing::warn!(event_id = e.id, dest = %loc, "도착지 지오코딩 실패 — leg skip");
                continue;
            }
        };

        // 경로(없으면 skip)
        let depart_local = start.with_timezone(&Local).naive_local();
        let Some(r) = route::route(state, from, to, depart_local).await? else {
            tracing::warn!(
                event_id = e.id,
                from = %origin_query,
                to = %loc,
                "대중교통 경로 없음(ODsay 0건/키 미설정/IP 미등록) — leg skip"
            );
            continue;
        };

        let depart = depart_by(start, r.duration_s, buffer_min);
        legs.push(Leg {
            event_id: e.id,
            summary: e.summary.clone(),
            from: clean_label(&origin_query),
            to: clean_label(loc),
            start_at: e.start_at.clone(),
            depart_by: depart.to_rfc3339(),
            duration_min: (r.duration_s + 59) / 60, // 올림
            transfers: r.transfers,
            mode: MODE.to_string(),
            route_detail: r.route_detail,
        });
    }
    Ok(legs)
}

async fn load_events(
    state: &AppState,
    user_id: i64,
    from_utc: &str,
    to_utc: &str,
) -> AppResult<Vec<Ev>> {
    let rows = sqlx::query(
        "SELECT id, summary, location, start_at, end_at, all_day \
         FROM events \
         WHERE user_id = ? AND status != 'cancelled' AND start_at >= ? AND start_at <= ? \
         ORDER BY start_at ASC",
    )
    .bind(user_id)
    .bind(from_utc)
    .bind(to_utc)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Ev {
            id: r.get("id"),
            summary: r.get("summary"),
            location: r.get("location"),
            start_at: r.get("start_at"),
            end_at: r.get("end_at"),
            all_day: r.get::<i64, _>("all_day") != 0,
        })
        .collect())
}

fn local_day_bounds_utc(day: NaiveDate) -> (String, String) {
    let tz = Local::now().timezone();
    let start = day
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(tz)
        .unwrap()
        .to_utc()
        .to_rfc3339();
    let end = day
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_local_timezone(tz)
        .unwrap()
        .to_utc()
        .to_rfc3339();
    (start, end)
}

fn parse_utc(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

async fn read_buffer_min(state: &AppState, user_id: i64) -> i64 {
    read_setting(state, user_id, "travel.buffer_min")
        .await
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|n| *n >= 0)
        .unwrap_or(DEFAULT_BUFFER_MIN)
}

async fn read_home(state: &AppState, user_id: i64) -> String {
    read_setting(state, user_id, "travel.home")
        .await
        .unwrap_or_default()
}

async fn read_setting(state: &AppState, user_id: i64, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT value FROM settings WHERE user_id = ? AND key = ?",
    )
    .bind(user_id)
    .bind(key)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .flatten()
}
