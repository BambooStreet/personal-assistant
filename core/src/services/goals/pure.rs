//! 목표/루틴의 순수 로직 — DB·네트워크·전역시각 의존 없음. cargo test 대상은 전부 여기.
//!
//! `routines_tick`은 "쿼리 → 루프 → due_state → 클레임 → emit" 배관만 남기고 판정은 전부
//! 이 모듈로 몰아넣는다(`services/travel/pure.rs`와 같은 구조).

use chrono::{NaiveDateTime, NaiveTime, Weekday};

/// 요일 비트마스크: bit0=월 … bit6=일. '매일'.
pub const DAILY_MASK: i64 = 0b111_1111;

/// 지각 발화 허용 상한(분).
///
/// 하한 근거: 스케줄러가 60초 tick이라 정상 상태에서도 최대 ~70초 늦게 돈다 — 정각 매칭은 쓸 수 없다.
/// 상한 근거: 노트북을 닫았다 여는 시나리오는 덮되, 3시간 지난 "10시에 하기로 했어요"는
/// 도움이 아니라 소음이다.
pub const ROUTINE_GRACE_MIN: i64 = 60;

const DAY_LABELS: [&str; 7] = ["월", "화", "수", "목", "금", "토", "일"];

const WEEKDAY_MASK: i64 = 0b001_1111; // 월~금 (bit0..bit4)
const WEEKEND_MASK: i64 = 0b110_0000; // 토, 일 (bit5, bit6)

/// chrono 요일 → 비트. `num_days_from_monday()`가 곧 비트 위치라 변환이 필요 없다.
pub fn today_bit(w: Weekday) -> i64 {
    1 << w.num_days_from_monday()
}

pub fn mask_contains(mask: i64, bit: i64) -> bool {
    mask & bit != 0
}

/// 사람이 읽는 요일 표기. "매일" / "평일" / "주말" / "월수금".
pub fn format_days(mask: i64) -> String {
    let m = mask & DAILY_MASK;
    if m == 0 {
        return String::new();
    }
    if m == DAILY_MASK {
        return "매일".into();
    }
    if m == WEEKDAY_MASK {
        return "평일".into();
    }
    if m == WEEKEND_MASK {
        return "주말".into();
    }
    (0..7)
        .filter(|i| m & (1 << i) != 0)
        .map(|i| DAY_LABELS[i as usize])
        .collect::<Vec<_>>()
        .concat()
}

/// "HH:MM"로 정규화. 깨진 입력은 None.
///
/// chrono의 `%H`는 한 자리 시("7:00")도 받아들이는데, 그대로 저장하면 `ORDER BY time_hhmm`
/// 문자열 정렬에서 "7:00" > "22:00"이 되어 브리핑 줄 순서가 깨진다. 거부하지 않고 0을 채운다.
pub fn normalize_hhmm(s: &str) -> Option<String> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M")
        .ok()
        .map(|t| t.format("%H:%M").to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DueState {
    /// 오늘 요일이 아니거나 시각 문자열이 깨졌음.
    NotToday,
    TooEarly,
    Due,
    /// 예정 시각이 grace를 넘겨 지나감 — 오늘은 건너뛴다.
    TooLate,
}

/// 지금 이 루틴을 쏴야 하는가.
///
/// now/scheduled 둘 다 **로컬 naive**로 비교해 시간대 모호성을 비교 단계에서 제거한다.
/// 오늘 날짜의 예정 시각만 보므로 grace가 자정을 넘어 어제 루틴을 되살리는 일이 없다.
pub fn due_state(
    now_local: NaiveDateTime,
    weekday_bit: i64,
    days_mask: i64,
    time_hhmm: &str,
    grace_min: i64,
) -> DueState {
    if !mask_contains(days_mask, weekday_bit) {
        return DueState::NotToday;
    }
    // 깨진 시각("bogus", "25:00")은 패닉이 아니라 조용한 스킵.
    let Ok(at) = NaiveTime::parse_from_str(time_hhmm, "%H:%M") else {
        return DueState::NotToday;
    };
    let scheduled = now_local.date().and_time(at);
    if now_local < scheduled {
        return DueState::TooEarly;
    }
    if now_local.signed_duration_since(scheduled).num_minutes() > grace_min {
        return DueState::TooLate;
    }
    DueState::Due
}

/// 오늘 쓸 '왜'를 고른다. 날짜 기반이라 상태 컬럼이 필요 없고 테스트가 결정적이다.
/// 같은 날 아침 브리핑과 밤 알림이 같은 why를 쓰게 되는데, 그날의 테마가 되어 오히려 자연스럽다.
pub fn pick_why(whys: &[String], epoch_day: i64) -> Option<&str> {
    if whys.is_empty() {
        return None;
    }
    let idx = epoch_day.rem_euclid(whys.len() as i64) as usize;
    Some(whys[idx].as_str())
}

/// LLM 실패·키 미설정 시 쓰는 결정론적 문구. 알림을 빼먹는 것보다 밋밋한 게 낫다.
pub fn fallback_message(title: &str, why: Option<&str>) -> String {
    match why {
        Some(w) if !w.trim().is_empty() => format!("{title} — {w}"),
        _ => format!("{title} — 약속한 시간이에요"),
    }
}

/// 아침 브리핑에 붙는 고정 줄. LLM 없이 코드가 만든다.
pub fn format_briefing_line(
    title: &str,
    days_mask: i64,
    time_hhmm: Option<&str>,
    why: Option<&str>,
) -> String {
    let mut s = format!("🎯 {title}");
    if let Some(t) = time_hhmm {
        let days = format_days(days_mask);
        if days.is_empty() {
            s.push_str(&format!(" · {t}"));
        } else {
            s.push_str(&format!(" · {days} {t}"));
        }
    }
    if let Some(w) = why {
        if !w.trim().is_empty() {
            s.push_str(&format!(" — {w}"));
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn dt(y: i32, m: u32, d: u32, h: u32, min: u32, s: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, s)
            .unwrap()
    }

    // ===== 요일 비트 규약 — 깨지면 알림이 하루씩 밀린다 =====

    #[test]
    fn today_bit_follows_monday_zero() {
        assert_eq!(today_bit(Weekday::Mon), 1);
        assert_eq!(today_bit(Weekday::Tue), 2);
        assert_eq!(today_bit(Weekday::Wed), 4);
        assert_eq!(today_bit(Weekday::Thu), 8);
        assert_eq!(today_bit(Weekday::Fri), 16);
        assert_eq!(today_bit(Weekday::Sat), 32);
        assert_eq!(today_bit(Weekday::Sun), 64);
    }

    #[test]
    fn daily_mask_contains_every_weekday() {
        for w in [
            Weekday::Mon,
            Weekday::Tue,
            Weekday::Wed,
            Weekday::Thu,
            Weekday::Fri,
            Weekday::Sat,
            Weekday::Sun,
        ] {
            assert!(mask_contains(DAILY_MASK, today_bit(w)), "{w:?}");
        }
    }

    // ===== format_days =====

    #[test]
    fn format_days_named_sets() {
        assert_eq!(format_days(DAILY_MASK), "매일");
        assert_eq!(format_days(0b001_1111), "평일");
        assert_eq!(format_days(0b110_0000), "주말");
    }

    #[test]
    fn format_days_arbitrary_set() {
        // 월(1) + 수(4) + 금(16)
        assert_eq!(format_days(0b001_0101), "월수금");
        assert_eq!(format_days(0b000_0001), "월");
        assert_eq!(format_days(0b100_0000), "일");
    }

    #[test]
    fn format_days_empty_is_blank() {
        assert_eq!(format_days(0), "");
    }

    // ===== due_state =====

    const MON: i64 = 1;
    const TUE: i64 = 2;

    #[test]
    fn not_today_when_weekday_missing() {
        // 화요일에 월요일만 켜진 루틴
        let now = dt(2026, 8, 18, 22, 0, 0);
        assert_eq!(due_state(now, TUE, MON, "22:00", 60), DueState::NotToday);
    }

    #[test]
    fn too_early_before_scheduled() {
        let now = dt(2026, 8, 17, 21, 59, 0);
        assert_eq!(due_state(now, MON, MON, "22:00", 60), DueState::TooEarly);
    }

    #[test]
    fn due_exactly_on_time() {
        let now = dt(2026, 8, 17, 22, 0, 0);
        assert_eq!(due_state(now, MON, MON, "22:00", 60), DueState::Due);
    }

    /// 60초 tick 드리프트 — 정각 매칭으로 구현하면 여기서 깨진다.
    #[test]
    fn due_within_tick_drift() {
        let now = dt(2026, 8, 17, 22, 0, 59);
        assert_eq!(due_state(now, MON, MON, "22:00", 60), DueState::Due);
    }

    /// 앱을 껐다가 22:30에 켠 경우 — 쏜다.
    #[test]
    fn due_when_late_within_grace() {
        let now = dt(2026, 8, 17, 22, 30, 0);
        assert_eq!(due_state(now, MON, MON, "22:00", 60), DueState::Due);
    }

    /// 23:01에 켠 경우 — 안 쏜다.
    #[test]
    fn too_late_past_grace() {
        let now = dt(2026, 8, 17, 23, 1, 0);
        assert_eq!(due_state(now, MON, MON, "22:00", 60), DueState::TooLate);
    }

    #[test]
    fn bad_time_string_is_skipped_not_panic() {
        let now = dt(2026, 8, 17, 22, 0, 0);
        assert_eq!(due_state(now, MON, MON, "bogus", 60), DueState::NotToday);
        assert_eq!(due_state(now, MON, MON, "25:00", 60), DueState::NotToday);
        assert_eq!(due_state(now, MON, MON, "", 60), DueState::NotToday);
    }

    #[test]
    fn midnight_routine_boundary() {
        assert_eq!(
            due_state(dt(2026, 8, 17, 0, 4, 0), MON, MON, "00:05", 60),
            DueState::TooEarly
        );
        assert_eq!(
            due_state(dt(2026, 8, 17, 0, 6, 0), MON, MON, "00:05", 60),
            DueState::Due
        );
    }

    /// grace가 날짜를 넘지 않는다 — 어제 23:50 루틴이 오늘 00:10에 되살아나면 안 된다.
    /// (오늘 23:50 기준으로 평가되므로 TooEarly)
    #[test]
    fn grace_does_not_cross_midnight() {
        let now = dt(2026, 8, 18, 0, 10, 0);
        assert_eq!(due_state(now, TUE, TUE, "23:50", 60), DueState::TooEarly);
    }

    // ===== pick_why =====

    fn whys(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("why{i}")).collect()
    }

    #[test]
    fn pick_why_empty_is_none() {
        assert_eq!(pick_why(&[], 12345), None);
    }

    #[test]
    fn pick_why_single_is_stable() {
        let w = whys(1);
        for day in [0, 1, 999, 100_000] {
            assert_eq!(pick_why(&w, day), Some("why0"));
        }
    }

    #[test]
    fn pick_why_rotates_daily() {
        let w = whys(3);
        assert_eq!(pick_why(&w, 0), Some("why0"));
        assert_eq!(pick_why(&w, 1), Some("why1"));
        assert_eq!(pick_why(&w, 2), Some("why2"));
        assert_eq!(pick_why(&w, 3), Some("why0"));
    }

    #[test]
    fn pick_why_handles_negative_epoch_day() {
        let w = whys(3);
        // rem_euclid가 아니면 인덱스가 음수가 되어 패닉.
        assert!(pick_why(&w, -1).is_some());
        assert!(pick_why(&w, -7).is_some());
    }

    // ===== 문구 포맷 =====

    #[test]
    fn fallback_with_and_without_why() {
        assert_eq!(
            fallback_message("영어 공부", Some("원서를 읽고 싶어서")),
            "영어 공부 — 원서를 읽고 싶어서"
        );
        assert_eq!(
            fallback_message("영어 공부", None),
            "영어 공부 — 약속한 시간이에요"
        );
        // 공백만 있는 why는 없는 것으로.
        assert_eq!(
            fallback_message("영어 공부", Some("   ")),
            "영어 공부 — 약속한 시간이에요"
        );
    }

    #[test]
    fn briefing_line_combinations() {
        assert_eq!(
            format_briefing_line("영어 공부", DAILY_MASK, Some("22:00"), Some("원서")),
            "🎯 영어 공부 · 매일 22:00 — 원서"
        );
        assert_eq!(
            format_briefing_line("러닝", 0b001_0101, Some("07:00"), None),
            "🎯 러닝 · 월수금 07:00"
        );
        // 루틴이 없는 목표 — 시각 없이 한 줄.
        assert_eq!(
            format_briefing_line("이직", 0, None, Some("선택지를 넓히려고")),
            "🎯 이직 — 선택지를 넓히려고"
        );
        assert_eq!(format_briefing_line("이직", 0, None, None), "🎯 이직");
    }

    #[test]
    fn hhmm_normalization() {
        assert_eq!(normalize_hhmm("00:00").as_deref(), Some("00:00"));
        assert_eq!(normalize_hhmm("23:59").as_deref(), Some("23:59"));
        // 한 자리 시는 0을 채워 저장 — 안 그러면 "7:00" > "22:00"으로 정렬된다.
        assert_eq!(normalize_hhmm("7:00").as_deref(), Some("07:00"));
        assert_eq!(normalize_hhmm(" 9:05 ").as_deref(), Some("09:05"));
        assert_eq!(normalize_hhmm("24:00"), None);
        assert_eq!(normalize_hhmm("bogus"), None);
        assert_eq!(normalize_hhmm(""), None);
    }

    /// 정규화된 문자열끼리는 사전순 정렬이 곧 시간순이다(브리핑 줄 정렬의 전제).
    #[test]
    fn normalized_hhmm_sorts_chronologically() {
        let mut v = vec!["22:00".to_string(), normalize_hhmm("7:00").unwrap()];
        v.sort();
        assert_eq!(v, vec!["07:00", "22:00"]);
    }
}
