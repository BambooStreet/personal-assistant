//! 네트워크/DB 없는 순수 로직 — 출발지 추론·캐시 키·버킷·시각 계산. cargo test 대상.

use chrono::{DateTime, Duration, NaiveDateTime, Timelike, Utc};

/// 출발지 추론에 쓰는 경량 이벤트(시각은 파싱된 UTC).
#[derive(Debug, Clone)]
pub struct EvLite {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub all_day: bool,
    pub location: Option<String>,
}

/// target 이벤트의 출발지.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Origin {
    /// 직전 일정 장소(텍스트).
    Prev(String),
    /// 집(travel.home) 사용.
    Home,
}

/// 좌표 라운딩(소수 5자리 ≈ 1m) — 같은 장소가 캐시에서 다른 키가 되는 걸 방지.
pub fn round_coord(v: f64) -> f64 {
    (v * 1e5).round() / 1e5
}

/// 지오코딩 입력/캐시 키 정규화 — trim + 연속 공백 1칸.
pub fn normalize_query(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 경로 캐시 키 = from좌표|to좌표|출발버킷|mode. 좌표는 5자리 고정폭으로 포맷.
pub fn route_cache_key(from: (f64, f64), to: (f64, f64), bucket: &str, mode: &str) -> String {
    format!(
        "{:.5},{:.5}|{:.5},{:.5}|{}|{}",
        from.0, from.1, to.0, to.1, bucket, mode
    )
}

/// 출발 시각 30분 버킷(로컬 naive 기준). 대중교통 소요는 30분 내 거의 불변 → 캐시 적중↑.
/// 호출부에서 `start.with_timezone(&Local).naive_local()`을 넘긴다(러시아워 의미 보존).
pub fn depart_bucket(local: NaiveDateTime) -> String {
    let half = if local.time().minute() < 30 { 'A' } else { 'B' };
    format!("{}{}", local.format("%Y%m%d%H"), half)
}

/// 지오코딩 후보 질의 목록. Google 캘린더 장소가 "POI, 대한민국 전체주소"처럼 와서
/// 통째론 키워드·주소 검색 모두 0건인 경우가 많다 → "대한민국" 제거 + 콤마 분할로 확장.
/// 전체(정리본) 먼저, 그다음 각 조각. 2자 미만·순수 숫자 조각은 제외.
pub fn geocode_candidates(raw: &str) -> Vec<String> {
    let cleaned = normalize_query(&raw.replace("대한민국", " "));
    let mut parts: Vec<String> = vec![cleaned.clone()];
    for p in cleaned.split(',') {
        parts.push(p.to_string());
    }
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        let s = normalize_query(&p);
        let non_ws = s.chars().filter(|c| !c.is_whitespace()).count();
        let all_digits = !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || c == ' ');
        if non_ws >= 2 && !all_digits && !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// 표시용 짧은 라벨. "대한민국" 제거 후 콤마 조각 중 첫 비-숫자 조각(보통 POI명 또는 주소).
/// 예: "81, 대한민국 서울특별시 종로구 성균관로5길 81" → "서울특별시 종로구 성균관로5길 81",
///     "서현역 로데오거리, 대한민국 성남시 서현로 216" → "서현역 로데오거리".
pub fn clean_label(raw: &str) -> String {
    let cleaned = normalize_query(&raw.replace("대한민국", " "));
    for seg in cleaned.split(',') {
        let s = normalize_query(seg);
        if !s.is_empty() && !s.chars().all(|c| c.is_ascii_digit() || c == ' ') {
            return s;
        }
    }
    cleaned
}

/// 출발 시각 = 도착(이벤트 시작) − 이동시간 − 버퍼.
pub fn depart_by(start: DateTime<Utc>, duration_s: i64, buffer_min: i64) -> DateTime<Utc> {
    start - Duration::seconds(duration_s) - Duration::minutes(buffer_min)
}

/// target 이벤트의 출발지 추론.
/// - 직전(인덱스 작은 쪽)부터 보며 all_day·무장소는 건너뛴다.
/// - 장소 있는 가장 가까운 직전 일정을 찾되, 그 종료~target 시작 간극이 max_gap_min 초과면
///   그 사이 집에 들렀다고 보고 Home으로 폴백한다.
/// - 후보가 없으면 Home.
pub fn resolve_origin(events: &[EvLite], target_idx: usize, max_gap_min: i64) -> Origin {
    if target_idx == 0 || target_idx > events.len() {
        return Origin::Home;
    }
    let target = &events[target_idx];
    for p in events[..target_idx].iter().rev() {
        if p.all_day {
            continue;
        }
        let loc = match &p.location {
            Some(l) if !l.trim().is_empty() => l,
            _ => continue,
        };
        let gap_min = (target.start - p.end).num_minutes();
        if gap_min > max_gap_min {
            return Origin::Home;
        }
        return Origin::Prev(loc.clone());
    }
    Origin::Home
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn ev(start: &str, end: &str, all_day: bool, loc: Option<&str>) -> EvLite {
        EvLite {
            start: utc(start),
            end: utc(end),
            all_day,
            location: loc.map(|s| s.to_string()),
        }
    }

    #[test]
    fn candidates_expand_messy_calendar_location() {
        // "POI, 대한민국 주소" → 전체(정리) + POI + 주소 조각, 숫자-only("81") 제외.
        let c = geocode_candidates("서현역 로데오거리, 대한민국 성남시 서현로 216");
        assert!(c.contains(&"서현역 로데오거리".to_string()));
        assert!(c.contains(&"성남시 서현로 216".to_string()));
        let h = geocode_candidates("81, 대한민국 서울특별시 종로구 성균관로5길 81");
        assert!(h.contains(&"서울특별시 종로구 성균관로5길 81".to_string()));
        assert!(!h.contains(&"81".to_string())); // 순수 숫자 조각 제외
    }

    #[test]
    fn candidates_simple_poi_single() {
        assert_eq!(geocode_candidates("강남역"), vec!["강남역".to_string()]);
    }

    #[test]
    fn clean_label_picks_pretty_segment() {
        assert_eq!(
            clean_label("서현역 로데오거리, 대한민국 성남시 서현로 216"),
            "서현역 로데오거리"
        );
        assert_eq!(
            clean_label("81, 대한민국 서울특별시 종로구 성균관로5길 81"),
            "서울특별시 종로구 성균관로5길 81"
        );
        assert_eq!(clean_label("강남역"), "강남역");
    }

    #[test]
    fn normalize_collapses_whitespace() {
        assert_eq!(normalize_query("  강남   스타벅스 "), "강남 스타벅스");
        assert_eq!(normalize_query("회사"), "회사");
    }

    #[test]
    fn round_coord_5_decimals() {
        assert_eq!(round_coord(37.123456789), 37.12346);
        assert_eq!(round_coord(127.0), 127.0);
    }

    #[test]
    fn cache_key_is_stable_and_fixed_width() {
        let k = route_cache_key((37.1, 127.2), (37.5, 127.9), "20260617AA", "transit");
        assert_eq!(k, "37.10000,127.20000|37.50000,127.90000|20260617AA|transit");
    }

    #[test]
    fn bucket_splits_on_half_hour() {
        let h = NaiveDateTime::parse_from_str("2026-06-17 09:29", "%Y-%m-%d %H:%M").unwrap();
        let h2 = NaiveDateTime::parse_from_str("2026-06-17 09:30", "%Y-%m-%d %H:%M").unwrap();
        assert_eq!(depart_bucket(h), "2026061709A");
        assert_eq!(depart_bucket(h2), "2026061709B");
    }

    #[test]
    fn depart_by_subtracts_duration_and_buffer() {
        let start = utc("2026-06-17T09:00:00Z");
        // 30분 이동 + 10분 버퍼 = 40분 전 출발
        assert_eq!(depart_by(start, 1800, 10), utc("2026-06-17T08:20:00Z"));
    }

    #[test]
    fn origin_uses_previous_event_location() {
        let evs = vec![
            ev("2026-06-17T09:00:00Z", "2026-06-17T10:00:00Z", false, Some("강남")),
            ev("2026-06-17T11:00:00Z", "2026-06-17T12:00:00Z", false, Some("판교")),
        ];
        assert_eq!(resolve_origin(&evs, 1, 240), Origin::Prev("강남".into()));
    }

    #[test]
    fn first_event_uses_home() {
        let evs = vec![ev("2026-06-17T09:00:00Z", "2026-06-17T10:00:00Z", false, Some("강남"))];
        assert_eq!(resolve_origin(&evs, 0, 240), Origin::Home);
    }

    #[test]
    fn skips_allday_and_locationless_prev() {
        let evs = vec![
            ev("2026-06-17T00:00:00Z", "2026-06-17T23:59:00Z", true, Some("종일행사")),
            ev("2026-06-17T08:00:00Z", "2026-06-17T09:00:00Z", false, None),
            ev("2026-06-17T09:30:00Z", "2026-06-17T10:00:00Z", false, Some("강남")),
            ev("2026-06-17T11:00:00Z", "2026-06-17T12:00:00Z", false, Some("판교")),
        ];
        // idx=3(판교)의 직전: 강남(idx2). 무장소(idx1)·종일(idx0)은 건너뜀.
        assert_eq!(resolve_origin(&evs, 3, 240), Origin::Prev("강남".into()));
    }

    #[test]
    fn large_gap_falls_back_to_home() {
        let evs = vec![
            ev("2026-06-16T09:00:00Z", "2026-06-16T10:00:00Z", false, Some("어제 장소")),
            ev("2026-06-17T11:00:00Z", "2026-06-17T12:00:00Z", false, Some("판교")),
        ];
        // 간극이 4h(240분)를 한참 초과 → Home.
        assert_eq!(resolve_origin(&evs, 1, 240), Origin::Home);
    }
}
