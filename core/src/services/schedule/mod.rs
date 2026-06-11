//! 일과 자동 배치(빈 슬롯 채우기)의 결정론 코어.
//!
//! 하이브리드 설계에서 "정확성"을 담당: 생활 프로필·캘린더 이벤트로 빈 시간을 정확히 계산하고
//! 할 일을 중요도순으로 베이스라인 배치한다. 판단·서술·재배치는 LLM이, 실제 생성 전 재검증도
//! 이 모듈을 다시 호출해서 한다(2e).
//!
//! 타임존(#2): 모든 슬롯 산수는 **대상 날짜의 로컬 자정 기준 "분(minute)" 단위**로만 한다.
//! 이벤트(RFC3339+offset)와 생활 프로필("HH:MM" 로컬 벽시계)을 같은 분 좌표로 환산해 비교하므로
//! naive ↔ offset 직접 비교가 발생하지 않는다. 경계(입출력)에서만 로컬 DateTime↔분 변환.

use chrono::{
    DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone, Timelike, Utc, Weekday,
};
use serde::{Deserialize, Serialize};

use crate::commands::todos::{self, TodosListArgs};
use crate::error::AppResult;
use crate::state::AppState;

// ===== 출력 구조 (LLM에 JSON으로 전달) =====

#[derive(Debug, Serialize)]
pub struct FreeSlot {
    pub start: String, // RFC3339 (로컬 offset)
    pub end: String,
    pub minutes: i64,
}

#[derive(Debug, Serialize)]
pub struct RankedTodo {
    pub id: i64,
    pub title: String,
    pub estimated_minutes: Option<i64>,
    pub priority: i64,
    pub due_at: Option<String>,
    pub score: i64,
}

#[derive(Debug, Serialize)]
pub struct Placement {
    pub todo_id: i64,
    pub title: String,
    pub start: String,
    pub end: String,
}

#[derive(Debug, Serialize)]
pub struct Unplaced {
    pub todo_id: i64,
    pub title: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct ScheduleSuggestion {
    pub date: String, // YYYY-MM-DD (로컬)
    pub tz: String,   // 로컬 offset 예: "+09:00"
    pub free_slots: Vec<FreeSlot>,
    pub ranked: Vec<RankedTodo>,
    pub proposed: Vec<Placement>,
    pub unplaced: Vec<Unplaced>,
}

// ===== 순수 코어 (분 단위, tz 독립 — 단위 테스트 대상) =====

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Interval {
    pub start: i64, // 로컬 자정 기준 분
    pub end: i64,
}

/// priority 인코딩(0=보통,1=낮음,2=높음,3=긴급)을 단조 rank로 정규화(#1).
/// 긴급(3) > 높음(2) > 보통(0) > 낮음(1).
pub(crate) fn priority_rank(p: i64) -> i64 {
    match p {
        3 => 3, // 긴급
        2 => 2, // 높음
        1 => 0, // 낮음
        _ => 1, // 보통(0) 및 알 수 없는 값
    }
}

/// 중요도 점수: 데드라인 근접도가 우선, priority가 동점을 가른다.
/// days_until_due: 마감까지 남은 일수(0 이하 = 오늘/지남), None = 마감 없음.
pub(crate) fn score(priority: i64, days_until_due: Option<i64>) -> i64 {
    let prio = priority_rank(priority) * 20; // 0,20,40,60
    let urgency = match days_until_due {
        None => 0,
        Some(d) if d <= 0 => 120,                  // 오늘/지남 = 최상
        Some(d) => (100 - d.min(99)).max(10),      // 가까울수록 큼, 최소 10
    };
    prio + urgency
}

/// 자정 넘김 처리(#3): 취침이 기상 이하이면 당일 경계(24:00=1440)로 클램프.
pub(crate) fn window_minutes(wake: i64, sleep: i64) -> Interval {
    let end = if sleep <= wake { 1440 } else { sleep };
    Interval { start: wake, end }
}

/// window에서 busy 구간들을 빼서 빈 구간(분)을 만든다. busy는 window로 클립 후 병합.
pub(crate) fn subtract(window: Interval, busy: &[Interval]) -> Vec<Interval> {
    let mut bs: Vec<Interval> = busy
        .iter()
        .filter_map(|b| {
            let s = b.start.max(window.start);
            let e = b.end.min(window.end);
            if e > s {
                Some(Interval { start: s, end: e })
            } else {
                None
            }
        })
        .collect();
    bs.sort_by_key(|b| b.start);

    let mut free = Vec::new();
    let mut cur = window.start;
    for b in bs {
        if b.start > cur {
            free.push(Interval {
                start: cur,
                end: b.start,
            });
        }
        cur = cur.max(b.end);
    }
    if cur < window.end {
        free.push(Interval {
            start: cur,
            end: window.end,
        });
    }
    free
}

/// 점수 내림차순으로 정렬된 (id, est) 목록을 빈 슬롯에 가장 이른 자리부터 greedy 배치.
/// 반환: (배치된 [(id,start,end)], 자리를 못 찾은 [id]).
pub(crate) fn greedy_place(
    free: &[Interval],
    todos: &[(i64, i64)],
) -> (Vec<(i64, i64, i64)>, Vec<i64>) {
    let mut slots: Vec<Interval> = free.to_vec();
    let mut placements = Vec::new();
    let mut unplaced = Vec::new();
    for &(id, est) in todos {
        let mut placed = false;
        for slot in slots.iter_mut() {
            if slot.end - slot.start >= est {
                let start = slot.start;
                let end = start + est;
                placements.push((id, start, end));
                slot.start = end;
                placed = true;
                break;
            }
        }
        if !placed {
            unplaced.push(id);
        }
    }
    (placements, unplaced)
}

/// "HH:MM" → 로컬 자정 기준 분. 파싱 실패 시 None.
pub(crate) fn parse_hhmm(s: &str) -> Option<i64> {
    let t = NaiveTime::parse_from_str(s, "%H:%M").ok()?;
    Some((t.num_seconds_from_midnight() / 60) as i64)
}

// ===== 생활 프로필 / 이벤트 로딩 =====

#[derive(Debug, Deserialize, Default)]
struct LifestyleBlock {
    #[serde(default)]
    days: Vec<i64>, // 0=월 … 6=일
    start: String,  // HH:MM
    end: String,
}

async fn read_setting(pool: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

struct DayWindow {
    day_start: DateTime<Local>,
    window: Interval,
    free: Vec<Interval>,
}

/// 대상 날짜의 가용 윈도우와 빈 슬롯(분)을 계산. suggest와 commit 재검증(2e)이 공유.
async fn build_day_window(state: &AppState, date: NaiveDate) -> AppResult<DayWindow> {
    let pool = &state.db;
    let is_weekend = matches!(date.weekday(), Weekday::Sat | Weekday::Sun);

    // 기상/취침 (요일 종류별), 기본값은 renderer LIFESTYLE_DEFAULTS와 동일.
    let (wake_key, sleep_key, wake_def, sleep_def) = if is_weekend {
        ("lifestyle.wake_weekend", "lifestyle.sleep_weekend", "09:00", "23:00")
    } else {
        ("lifestyle.wake_weekday", "lifestyle.sleep_weekday", "08:00", "23:00")
    };
    let wake = parse_hhmm(&read_setting(pool, wake_key).await.unwrap_or_default())
        .unwrap_or_else(|| parse_hhmm(wake_def).unwrap());
    let sleep = parse_hhmm(&read_setting(pool, sleep_key).await.unwrap_or_default())
        .unwrap_or_else(|| parse_hhmm(sleep_def).unwrap());
    let window = window_minutes(wake, sleep);

    // 로컬 자정 기준점.
    let day_start = local_midnight(date);

    // busy = 시간 이벤트(종일 제외) + 해당 요일에 걸리는 반복 블록.
    let mut busy: Vec<Interval> = Vec::new();

    // 블록.
    let block_weekday = date.weekday().num_days_from_monday() as i64; // 0=월..6=일
    let blocks_raw = read_setting(pool, "lifestyle.blocks").await.unwrap_or_default();
    let blocks: Vec<LifestyleBlock> = serde_json::from_str(&blocks_raw).unwrap_or_default();
    for b in &blocks {
        if !b.days.contains(&block_weekday) {
            continue;
        }
        if let (Some(s), Some(e)) = (parse_hhmm(&b.start), parse_hhmm(&b.end)) {
            if e > s {
                busy.push(Interval { start: s, end: e });
            }
        }
    }

    // 이벤트(대상 날짜에 겹치는 것). 종일 이벤트는 특정 시각이 없으므로 슬롯 점유에서 제외.
    let day_end = day_start + Duration::days(1);
    let day_start_utc = day_start.with_timezone(&Utc).to_rfc3339();
    let day_end_utc = day_end.with_timezone(&Utc).to_rfc3339();
    let rows = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT start_at, end_at, all_day FROM events \
         WHERE status != 'cancelled' AND end_at > ? AND start_at < ? ORDER BY start_at ASC",
    )
    .bind(&day_start_utc)
    .bind(&day_end_utc)
    .fetch_all(pool)
    .await?;
    for (start_at, end_at, all_day) in rows {
        if all_day != 0 {
            continue;
        }
        if let (Some(s), Some(e)) = (
            to_local_minutes(&start_at, day_start),
            to_local_minutes(&end_at, day_start),
        ) {
            if e > s {
                busy.push(Interval { start: s, end: e });
            }
        }
    }

    let free = subtract(window, &busy);
    Ok(DayWindow {
        day_start,
        window,
        free,
    })
}

// ===== tz 경계 변환 =====

fn local_midnight(date: NaiveDate) -> DateTime<Local> {
    // 로컬 자정. 분기(DST)에서 모호하면 가장 이른 시각을, 없으면 정오 기준으로 보정(한국은 무관).
    let naive = date.and_hms_opt(0, 0, 0).unwrap();
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => dt,
        chrono::LocalResult::Ambiguous(dt, _) => dt,
        chrono::LocalResult::None => Local
            .from_local_datetime(&date.and_hms_opt(12, 0, 0).unwrap())
            .single()
            .unwrap(),
    }
}

/// RFC3339 문자열 → 대상 로컬 자정 기준 분. day_start와 같은 날이 아니어도 차이로 계산.
fn to_local_minutes(rfc3339: &str, day_start: DateTime<Local>) -> Option<i64> {
    let dt = DateTime::parse_from_rfc3339(rfc3339).ok()?.with_timezone(&Local);
    Some((dt - day_start).num_minutes())
}

fn minutes_to_rfc3339(day_start: DateTime<Local>, m: i64) -> String {
    (day_start + Duration::minutes(m)).to_rfc3339()
}

// ===== 공개 API =====

/// 대상 날짜(기본 오늘)의 일과 배치 추천을 계산.
pub async fn suggest_schedule(
    state: &AppState,
    date: Option<String>,
) -> AppResult<ScheduleSuggestion> {
    let target = date
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| Local::now().date_naive());

    let day = build_day_window(state, target).await?;

    // 미완료 todos.
    let todos = todos::todos_list(
        state,
        TodosListArgs {
            include_done: Some(false),
        },
    )
    .await?;

    // 점수화.
    let mut ranked: Vec<(RankedTodo, Option<i64>)> = todos
        .into_iter()
        .map(|t| {
            let days_until = t.due_at.as_deref().and_then(|d| days_until_due(d, target));
            let sc = score(t.priority, days_until);
            (
                RankedTodo {
                    id: t.id,
                    title: t.title,
                    estimated_minutes: t.estimated_minutes,
                    priority: t.priority,
                    due_at: t.due_at,
                    score: sc,
                },
                t.estimated_minutes,
            )
        })
        .collect();
    ranked.sort_by(|a, b| b.0.score.cmp(&a.0.score).then(a.0.id.cmp(&b.0.id)));

    // greedy 배치 대상: 소요시간 있는 것만. 없는 것은 unplaced(사유 분리).
    let placeable: Vec<(i64, i64)> = ranked
        .iter()
        .filter_map(|(rt, est)| est.map(|e| (rt.id, e)))
        .collect();
    let (placed, unfit) = greedy_place(&day.free, &placeable);

    let title_of = |id: i64| -> String {
        ranked
            .iter()
            .find(|(rt, _)| rt.id == id)
            .map(|(rt, _)| rt.title.clone())
            .unwrap_or_default()
    };

    let proposed: Vec<Placement> = placed
        .iter()
        .map(|&(id, s, e)| Placement {
            todo_id: id,
            title: title_of(id),
            start: minutes_to_rfc3339(day.day_start, s),
            end: minutes_to_rfc3339(day.day_start, e),
        })
        .collect();

    let mut unplaced: Vec<Unplaced> = Vec::new();
    for (rt, est) in &ranked {
        if est.is_none() {
            unplaced.push(Unplaced {
                todo_id: rt.id,
                title: rt.title.clone(),
                reason: "소요시간 미입력".into(),
            });
        } else if unfit.contains(&rt.id) {
            unplaced.push(Unplaced {
                todo_id: rt.id,
                title: rt.title.clone(),
                reason: "빈 시간 부족".into(),
            });
        }
    }

    let free_slots: Vec<FreeSlot> = day
        .free
        .iter()
        .map(|iv| FreeSlot {
            start: minutes_to_rfc3339(day.day_start, iv.start),
            end: minutes_to_rfc3339(day.day_start, iv.end),
            minutes: iv.end - iv.start,
        })
        .collect();

    Ok(ScheduleSuggestion {
        date: target.format("%Y-%m-%d").to_string(),
        tz: day.day_start.offset().to_string(),
        free_slots,
        ranked: ranked.into_iter().map(|(rt, _)| rt).collect(),
        proposed,
        unplaced,
    })
}

/// due_at(RFC3339) → 대상 날짜 기준 남은 일수(로컬 날짜 비교).
fn days_until_due(due_at: &str, target: NaiveDate) -> Option<i64> {
    let due = DateTime::parse_from_rfc3339(due_at)
        .ok()?
        .with_timezone(&Local)
        .date_naive();
    Some((due - target).num_days())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_rank_is_monotonic() {
        // 긴급(3) > 높음(2) > 보통(0) > 낮음(1)
        assert!(priority_rank(3) > priority_rank(2));
        assert!(priority_rank(2) > priority_rank(0));
        assert!(priority_rank(0) > priority_rank(1));
    }

    #[test]
    fn deadline_dominates_priority() {
        // 오늘 마감인 보통 할 일이, 마감 없는 긴급 할 일보다 먼저.
        let due_today = score(0, Some(0));
        let urgent_no_due = score(3, None);
        assert!(due_today > urgent_no_due);
    }

    #[test]
    fn nearer_deadline_scores_higher() {
        assert!(score(0, Some(1)) > score(0, Some(5)));
    }

    #[test]
    fn midnight_clamp_when_sleep_le_wake() {
        // 취침 01:00(60) <= 기상 08:00(480) → 당일 경계 1440으로 클램프(#3).
        let w = window_minutes(480, 60);
        assert_eq!(w, Interval { start: 480, end: 1440 });
    }

    #[test]
    fn subtract_makes_gaps_around_busy() {
        // 09:00–18:00(540–1080) 윈도우에서 12:00–13:00(720–780) 차감 → 두 슬롯.
        let window = Interval { start: 540, end: 1080 };
        let busy = [Interval { start: 720, end: 780 }];
        let free = subtract(window, &busy);
        assert_eq!(
            free,
            vec![
                Interval { start: 540, end: 720 },
                Interval { start: 780, end: 1080 },
            ]
        );
    }

    #[test]
    fn subtract_merges_overlapping_busy() {
        let window = Interval { start: 0, end: 100 };
        let busy = [
            Interval { start: 10, end: 40 },
            Interval { start: 30, end: 60 },
        ];
        let free = subtract(window, &busy);
        assert_eq!(
            free,
            vec![
                Interval { start: 0, end: 10 },
                Interval { start: 60, end: 100 },
            ]
        );
    }

    #[test]
    fn greedy_places_in_earliest_fitting_slot_and_skips_overflow() {
        let free = vec![
            Interval { start: 0, end: 30 },   // 30분
            Interval { start: 100, end: 220 }, // 120분
        ];
        // 50분짜리(첫 슬롯 안 맞음 → 둘째에), 20분짜리(첫 슬롯), 500분짜리(못 들어감).
        let (placed, unfit) = greedy_place(&free, &[(1, 50), (2, 20), (3, 500)]);
        assert_eq!(placed, vec![(1, 100, 150), (2, 0, 20)]);
        assert_eq!(unfit, vec![3]);
    }

    #[test]
    fn parse_hhmm_roundtrip() {
        assert_eq!(parse_hhmm("00:00"), Some(0));
        assert_eq!(parse_hhmm("09:30"), Some(570));
        assert_eq!(parse_hhmm("23:59"), Some(1439));
        assert_eq!(parse_hhmm("bad"), None);
    }
}
