//! 부팅 인사의 순수 로직 — 재회 간격 분류, 시간대, 아침 창 판정, 폴백 문구.
//!
//! DB·네트워크·전역 시각에 의존하지 않는다. 시각은 전부 인자로 받는다.

use chrono::{NaiveDateTime, NaiveTime};

/// 마지막 인사로부터 이 시간 안에 앱이 다시 뜨면 조용히 넘어간다.
///
/// 하한은 "크래시·재부팅으로 연달아 인사하지 않게", 상한은 "아침·점심·저녁에 각각
/// 인사할 수 있게". 3시간이 그 사이다.
pub const COOLDOWN_HOURS: i64 = 3;

/// 모닝 브리핑을 만들 시간 창의 기본값. 사용자가 설정에서 바꾼다.
pub const DEFAULT_WINDOW_START: &str = "05:00";
pub const DEFAULT_WINDOW_END: &str = "13:00";

/// 지금이 하루 중 어느 결인지. 인사 문구의 톤을 가른다
/// (아침이면 "오늘 뭐 할 거예요?", 저녁이면 "오늘 뭐 했어요?").
///
/// 원래 `services/briefing.rs`에 있었다. 브리핑이 아침 전용이 되면서 이 구분을 실제로
/// 쓰는 쪽이 인사가 됐으므로 이리로 옮겼다(D-025).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeSlot {
    Dawn,
    Morning,
    Midday,
    Afternoon,
    Evening,
    Night,
}

pub fn time_slot(hour: u32) -> TimeSlot {
    match hour {
        0..=4 => TimeSlot::Dawn,
        5..=10 => TimeSlot::Morning,
        11..=13 => TimeSlot::Midday,
        14..=17 => TimeSlot::Afternoon,
        18..=21 => TimeSlot::Evening,
        _ => TimeSlot::Night,
    }
}

impl TimeSlot {
    pub fn label(self) -> &'static str {
        match self {
            TimeSlot::Dawn => "새벽",
            TimeSlot::Morning => "아침",
            TimeSlot::Midday => "점심 무렵",
            TimeSlot::Afternoon => "오후",
            TimeSlot::Evening => "저녁",
            TimeSlot::Night => "밤",
        }
    }
}

/// 마지막으로 마주친 뒤 얼마 만에 다시 만났는가.
///
/// **시간 차이가 아니라 로컬 캘린더 일수로 가른다.** 20시간 차이가 이틀 밤을 걸칠 수도,
/// 같은 날 안에 들어갈 수도 있는데 사람이 체감하는 "며칠 만"은 후자다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reunion {
    /// 기록 없음 — 첫 인사.
    First,
    /// 같은 날 다시.
    Again,
    /// 하루 넘김.
    Overnight,
    /// 2~6일 만.
    FewDays(i64),
    /// 일주일 이상.
    LongTime(i64),
}

impl Reunion {
    /// 페이로드에 실어 사후 판정·디버깅에 쓰는 태그.
    pub fn tag(self) -> &'static str {
        match self {
            Reunion::First => "first",
            Reunion::Again => "again",
            Reunion::Overnight => "overnight",
            Reunion::FewDays(_) => "few_days",
            Reunion::LongTime(_) => "long_time",
        }
    }
}

pub fn classify_gap(prev: Option<NaiveDateTime>, now: NaiveDateTime) -> Reunion {
    let Some(prev) = prev else {
        return Reunion::First;
    };
    let days = (now.date() - prev.date()).num_days();
    match days {
        // 시계가 뒤로 갔거나(수동 조정·서머타임) 같은 날 → 방금 본 사이.
        i64::MIN..=0 => Reunion::Again,
        1 => Reunion::Overnight,
        2..=6 => Reunion::FewDays(days),
        _ => Reunion::LongTime(days),
    }
}

/// 프롬프트에 그대로 실리는 지시문.
///
/// `TimeSlot::framing()`의 대체품이되 성격이 다르다 — "무엇을 하라"가 아니라 "어떤 결로
/// 인사하라"만 담는다. **할 일·일정을 짚으라는 말은 한 글자도 넣지 않는다**(D-025).
pub fn reunion_framing(r: Reunion) -> &'static str {
    match r {
        Reunion::First => "처음 마주하는 자리예요. 짧게 반갑다고만 해요.",
        Reunion::Again => {
            "오늘 이미 한 번 만났어요. 처음 만난 것처럼 굴지 말고, 다시 봐서 반갑다는 결로 \
             가볍게 건네요."
        }
        Reunion::Overnight => "하루 만이에요. 어제 인사한 사이답게 편하게 건네요.",
        Reunion::FewDays(_) => {
            "며칠 만이에요. 그동안 잘 지냈는지 궁금해하는 결로, 부담 주지 않게 물어요."
        }
        Reunion::LongTime(_) => {
            "일주일 넘게 못 봤어요. 오랜만이라는 걸 알아주고 안부를 묻는 결로. \
             왜 안 왔냐고 따지듯 말하지 않아요."
        }
    }
}

/// `"HH:MM"` ~ `"HH:MM"` 창에 지금이 들어가는지. 끝 시각은 포함하지 않는다.
///
/// `start > end`면 자정을 넘긴 창으로 본다(`notifications`의 DND 판정과 같은 모양).
/// 값이 깨졌으면 **기본 창으로 폴백**한다 — 설정 오타가 브리핑을 영원히 죽이면 안 된다.
pub fn in_time_window(now: NaiveTime, start: &str, end: &str) -> bool {
    let (s, e) = match (parse_hhmm(start), parse_hhmm(end)) {
        (Some(s), Some(e)) => (s, e),
        _ => (
            parse_hhmm(DEFAULT_WINDOW_START).unwrap(),
            parse_hhmm(DEFAULT_WINDOW_END).unwrap(),
        ),
    };
    if s <= e {
        now >= s && now < e
    } else {
        now >= s || now < e
    }
}

fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()
}

/// 키 없음·LLM 실패 시 즉시 쓰는 문구. **인사를 빼먹느니 밋밋한 게 낫다.**
///
/// `seed`(보통 epoch day)로 로테이션해 매번 같은 문장이 나오지 않게 한다
/// (`goals::pure::pick_why`와 같은 방식).
pub fn fallback_greeting(r: Reunion, slot: TimeSlot, name: Option<&str>, seed: i64) -> String {
    let pool = fallback_pool(r, slot);
    let idx = seed.rem_euclid(pool.len() as i64) as usize;
    let vocative = match name {
        Some(n) if !n.trim().is_empty() => format!(", {}님", n.trim()),
        _ => String::new(),
    };
    pool[idx].replace("{name}", &vocative)
}

/// 폴백 문구 풀. 전부 해요체이고, **할 일·일정 얘기는 하지 않는다**.
fn fallback_pool(r: Reunion, slot: TimeSlot) -> &'static [&'static str] {
    use TimeSlot::*;
    match r {
        Reunion::First => &[
            "처음 뵈어요{name}. 앞으로 잘 부탁해요.",
            "반가워요{name}. 이제 자주 봐요.",
        ],
        Reunion::Again => match slot {
            Dawn | Morning => &[
                "또 봐요{name}. 오늘은 뭐 할 거예요?",
                "금방 다시 왔네요{name}. 반가워요.",
            ],
            Midday | Afternoon => &[
                "또 봐서 반가워요{name}.",
                "다시 왔네요{name}. 오후는 어때요?",
            ],
            Evening | Night => &[
                "또 봐요{name}. 오늘 뭐 했어요?",
                "다시 봐서 반가워요{name}. 오늘 어땠어요?",
            ],
        },
        Reunion::Overnight => match slot {
            Dawn => &[
                "이른 시간이네요{name}. 잘 잤어요?",
                "새벽이에요{name}. 무리하지 말고요.",
            ],
            Morning => &[
                "좋은 아침이에요{name}. 오늘은 뭐 할 거예요?",
                "잘 잤어요{name}? 오늘도 반가워요.",
            ],
            Midday => &[
                "안녕하세요{name}. 오늘은 좀 어때요?",
                "점심 무렵이네요{name}. 잘 지내고 있어요?",
            ],
            Afternoon => &[
                "다시 봐요{name}. 오늘 어때요?",
                "오후네요{name}. 오늘은 어떻게 보내고 있어요?",
            ],
            Evening => &[
                "좋은 저녁이에요{name}. 오늘 뭐 했어요?",
                "저녁이네요{name}. 오늘 하루 어땠어요?",
            ],
            Night => &[
                "늦었네요{name}. 오늘 하루 어땠어요?",
                "밤이에요{name}. 오늘도 고생했어요.",
            ],
        },
        Reunion::FewDays(_) => &[
            "며칠 만이네요{name}. 잘 지냈어요?",
            "오랜만이에요{name}. 그동안 어떻게 지냈어요?",
        ],
        Reunion::LongTime(_) => &[
            "오랜만이에요{name}. 잘 지냈어요?",
            "한참 만이네요{name}. 그동안 별일 없었죠?",
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn dt(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    fn t(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn 시간대_슬롯_경계() {
        assert_eq!(time_slot(0), TimeSlot::Dawn);
        assert_eq!(time_slot(4), TimeSlot::Dawn);
        assert_eq!(time_slot(5), TimeSlot::Morning);
        assert_eq!(time_slot(10), TimeSlot::Morning);
        assert_eq!(time_slot(11), TimeSlot::Midday);
        assert_eq!(time_slot(13), TimeSlot::Midday);
        assert_eq!(time_slot(14), TimeSlot::Afternoon);
        assert_eq!(time_slot(17), TimeSlot::Afternoon);
        assert_eq!(time_slot(18), TimeSlot::Evening);
        assert_eq!(time_slot(21), TimeSlot::Evening);
        assert_eq!(time_slot(22), TimeSlot::Night);
        assert_eq!(time_slot(23), TimeSlot::Night);
    }

    #[test]
    fn 기록이_없으면_첫_인사() {
        assert_eq!(classify_gap(None, dt(2026, 8, 30, 9, 0)), Reunion::First);
    }

    /// 간격 판정은 **경과 시간이 아니라 캘린더 일수**다. 이 두 케이스가 그걸 못 박는다:
    /// 같은 날 11시간 59분은 `Again`, 자정을 걸친 13시간은 `Overnight`.
    #[test]
    fn 재회_간격은_캘린더_일수로_가른다() {
        assert_eq!(
            classify_gap(Some(dt(2026, 8, 30, 0, 1)), dt(2026, 8, 30, 12, 0)),
            Reunion::Again
        );
        assert_eq!(
            classify_gap(Some(dt(2026, 8, 30, 23, 0)), dt(2026, 8, 31, 12, 0)),
            Reunion::Overnight
        );
    }

    #[test]
    fn 재회_간격_구간() {
        let now = dt(2026, 8, 30, 9, 0);
        assert_eq!(
            classify_gap(Some(dt(2026, 8, 28, 9, 0)), now),
            Reunion::FewDays(2)
        );
        assert_eq!(
            classify_gap(Some(dt(2026, 8, 24, 9, 0)), now),
            Reunion::FewDays(6)
        );
        assert_eq!(
            classify_gap(Some(dt(2026, 8, 23, 9, 0)), now),
            Reunion::LongTime(7)
        );
    }

    /// 시계가 뒤로 가도(수동 조정·서머타임) 패닉하거나 "-3일 만이네요"가 되면 안 된다.
    #[test]
    fn 미래_기록은_방금_본_것으로_친다() {
        assert_eq!(
            classify_gap(Some(dt(2026, 9, 5, 9, 0)), dt(2026, 8, 30, 9, 0)),
            Reunion::Again
        );
    }

    #[test]
    fn 아침_창_판정() {
        let (s, e) = ("05:00", "13:00");
        assert!(!in_time_window(t(4, 59), s, e));
        assert!(in_time_window(t(5, 0), s, e));
        assert!(in_time_window(t(12, 59), s, e));
        assert!(!in_time_window(t(13, 0), s, e)); // 끝 시각은 포함하지 않는다
    }

    #[test]
    fn 자정을_넘긴_창() {
        let (s, e) = ("22:00", "02:00");
        assert!(in_time_window(t(23, 0), s, e));
        assert!(in_time_window(t(1, 0), s, e));
        assert!(!in_time_window(t(3, 0), s, e));
    }

    /// 설정 값이 깨져도 브리핑이 영원히 안 뜨는 상태가 되면 안 된다.
    #[test]
    fn 깨진_창_설정은_기본값으로_폴백() {
        assert!(in_time_window(t(9, 0), "25:00", "13:00"));
        assert!(in_time_window(t(9, 0), "", ""));
        assert!(!in_time_window(t(20, 0), "abc", "13:00"));
    }

    /// 요구사항의 핵심 — **인사는 인사만 한다.** 폴백 문구가 할 일·일정을 짚기 시작하면
    /// 키 없는 사용자에게는 그게 유일하게 보이는 인사가 된다.
    #[test]
    fn 폴백_문구는_인사만_한다() {
        let slots = [
            TimeSlot::Dawn,
            TimeSlot::Morning,
            TimeSlot::Midday,
            TimeSlot::Afternoon,
            TimeSlot::Evening,
            TimeSlot::Night,
        ];
        let reunions = [
            Reunion::First,
            Reunion::Again,
            Reunion::Overnight,
            Reunion::FewDays(3),
            Reunion::LongTime(10),
        ];
        for r in reunions {
            for slot in slots {
                for seed in [0, 1, 2, -1, 12345] {
                    let s = fallback_greeting(r, slot, Some("지훈"), seed);
                    assert!(!s.trim().is_empty(), "{r:?}/{slot:?} 폴백이 비어 있음");
                    assert!(!s.contains("습니다"), "합쇼체가 섞임: {s}");
                    for banned in ["할 일", "일정", "마감", "목표"] {
                        assert!(!s.contains(banned), "인사가 {banned}을(를) 언급함: {s}");
                    }
                    assert!(s.contains("지훈님"), "이름이 안 불림: {s}");
                }
            }
        }
    }

    #[test]
    fn 이름이_없으면_호칭을_생략한다() {
        let s = fallback_greeting(Reunion::LongTime(9), TimeSlot::Evening, None, 0);
        assert!(!s.contains("님"), "{s}");
        assert!(!s.contains("{name}"), "치환 안 된 자리표시자: {s}");
        // 공백만 있는 이름도 없는 것으로 친다.
        let s2 = fallback_greeting(Reunion::Again, TimeSlot::Morning, Some("  "), 0);
        assert!(!s2.contains("님"), "{s2}");
    }

    #[test]
    fn 재회_지시문은_할_일을_짚으라고_하지_않는다() {
        for r in [
            Reunion::First,
            Reunion::Again,
            Reunion::Overnight,
            Reunion::FewDays(2),
            Reunion::LongTime(8),
        ] {
            let f = reunion_framing(r);
            assert!(!f.is_empty());
            for banned in ["할 일", "일정", "마감"] {
                assert!(!f.contains(banned), "{r:?} 지시문이 {banned}을(를) 언급함");
            }
        }
    }
}
