//! 목표/루틴의 DB 통합 테스트. 순수 로직은 `pure.rs`에, 여기는 **DB가 있어야만** 검증되는 것들 —
//! 테넌시 격리, 캐스케이드 삭제, 디듑, 이벤트 발화, 설정 게이팅.
//!
//! 시각 의존 주의: `routines_tick`은 내부에서 `Local::now()`를 쓴다. 그래서 "발화하는" 케이스는
//! 루틴 시각을 **지금 이 순간의 HH:MM**으로 잡는다 — `now >= scheduled`이면서 차이가 1분 미만이라
//! 항상 `Due`다. `now - 1분` 같은 걸 쓰면 자정 직후(00:00:30)에 어제 시각이 되어 깨진다.

use chrono::{Datelike, Local};

use super::*;
use crate::testing::{add_user, count, set_setting, test_state};

const USER: i64 = 1;

fn now_hhmm() -> String {
    Local::now().format("%H:%M").to_string()
}

/// 오늘이 아닌 요일만 켜진 마스크.
fn tomorrow_only_mask() -> i64 {
    1 << Local::now().weekday().succ().num_days_from_monday()
}

async fn seed_goal(state: &AppState, user_id: i64, title: &str, whys: &[&str]) -> i64 {
    let g = create(
        state,
        user_id,
        GoalDraft {
            title: title.into(),
            target_ym: None,
            whys: whys.iter().map(|w| w.to_string()).collect(),
            milestones: vec![],
        },
    )
    .await
    .expect("목표 생성");
    g.id
}

async fn seed_routine(state: &AppState, user_id: i64, goal_id: i64, hhmm: &str, mask: i64) -> i64 {
    routine_create(
        state,
        user_id,
        RoutineDraft {
            goal_id,
            time_hhmm: hhmm.into(),
            days_mask: mask,
        },
    )
    .await
    .expect("루틴 생성")
    .id
}

// ===== CRUD =====

#[tokio::test]
async fn create_and_list_nests_whys_and_routines() {
    let (state, _rx) = test_state().await;
    let gid = seed_goal(&state, USER, "영어 회화", &["통역 없이 미팅하려고", "이직 준비"]).await;
    seed_routine(&state, USER, gid, "22:00", pure::DAILY_MASK).await;

    let goals = list(&state, USER).await.unwrap();
    assert_eq!(goals.len(), 1);
    assert_eq!(goals[0].title, "영어 회화");
    assert_eq!(goals[0].whys.len(), 2);
    assert_eq!(goals[0].routines.len(), 1);
    // days_label은 Core가 만들어 준다(렌더러가 포맷을 복제하지 않도록).
    assert_eq!(goals[0].routines[0].days_label, "매일");
}

#[tokio::test]
async fn update_replaces_whys_wholesale() {
    let (state, _rx) = test_state().await;
    let gid = seed_goal(&state, USER, "영어", &["이유1", "이유2"]).await;

    let updated = update(
        &state,
        USER,
        gid,
        GoalDraft {
            title: "영어 회화".into(),
            target_ym: None,
            whys: vec!["새 이유".into()],
            milestones: vec![],
        },
    )
    .await
    .unwrap();

    assert_eq!(updated.title, "영어 회화");
    assert_eq!(updated.whys.len(), 1, "옛 why가 남아 있으면 안 된다");
    assert_eq!(updated.whys[0].text, "새 이유");
}

#[tokio::test]
async fn empty_title_rejected() {
    let (state, _rx) = test_state().await;
    let r = create(
        &state,
        USER,
        GoalDraft {
            title: "   ".into(),
            target_ym: None,
            whys: vec![],
            milestones: vec![],
        },
    )
    .await;
    assert!(r.is_err());
}

#[tokio::test]
async fn duplicate_routine_is_friendly_error_not_db_error() {
    let (state, _rx) = test_state().await;
    let gid = seed_goal(&state, USER, "영어", &[]).await;
    seed_routine(&state, USER, gid, "22:00", pure::DAILY_MASK).await;

    let err = routine_create(
        &state,
        USER,
        RoutineDraft {
            goal_id: gid,
            time_hhmm: "22:00".into(),
            days_mask: pure::DAILY_MASK,
        },
    )
    .await
    .unwrap_err();

    // UNIQUE 위반이 sqlx 에러로 새면 사용자에게 흉한 메시지가 간다.
    assert!(
        matches!(err, AppError::InvalidInput(_)),
        "InvalidInput이어야 하는데 {err:?}"
    );
}

#[tokio::test]
async fn routine_time_is_normalized_on_write() {
    let (state, _rx) = test_state().await;
    let gid = seed_goal(&state, USER, "러닝", &[]).await;
    let r = routine_create(
        &state,
        USER,
        RoutineDraft {
            goal_id: gid,
            time_hhmm: "7:00".into(),
            days_mask: pure::DAILY_MASK,
        },
    )
    .await
    .unwrap();
    // 0을 안 채우면 ORDER BY time_hhmm에서 "7:00" > "22:00"이 된다.
    assert_eq!(r.time_hhmm, "07:00");
}

// ===== 캐스케이드 삭제 (FK가 없어 코드가 손으로 지운다) =====

#[tokio::test]
async fn delete_cascades_whys_routines_and_sent_rows() {
    let (state, mut rx) = test_state().await;
    let gid = seed_goal(&state, USER, "영어", &["이유"]).await;
    let rid = seed_routine(&state, USER, gid, &now_hhmm(), pure::DAILY_MASK).await;

    // 발화시켜 routine_notifications_sent에 행을 만든다.
    routines_tick(&state, USER).await.unwrap();
    let _ = rx.try_recv();
    assert_eq!(
        count(&state, "SELECT COUNT(*) FROM routine_notifications_sent").await,
        1
    );

    delete(&state, USER, gid).await.unwrap();

    assert_eq!(count(&state, "SELECT COUNT(*) FROM goals").await, 0);
    assert_eq!(count(&state, "SELECT COUNT(*) FROM goal_whys").await, 0);
    assert_eq!(count(&state, "SELECT COUNT(*) FROM goal_routines").await, 0);
    assert_eq!(
        count(&state, "SELECT COUNT(*) FROM routine_notifications_sent").await,
        0,
        "sent 행이 남으면 같은 id가 재사용될 때 알림이 안 뜬다"
    );
    let _ = rid;
}

// ===== 테넌시 격리 (user_id 빠뜨린 쿼리 색출) =====

#[tokio::test]
async fn other_user_cannot_see_or_touch_my_goal() {
    let (state, _rx) = test_state().await;
    add_user(&state, 2, "other").await;
    let gid = seed_goal(&state, USER, "내 목표", &["내 이유"]).await;

    assert!(list(&state, 2).await.unwrap().is_empty());
    assert!(delete(&state, 2, gid).await.is_err());
    assert!(update(
        &state,
        2,
        gid,
        GoalDraft {
            title: "탈취".into(),
            target_ym: None,
            whys: vec![],
            milestones: vec![],
        }
    )
    .await
    .is_err());

    // 원본이 멀쩡한지.
    assert_eq!(list(&state, USER).await.unwrap().len(), 1);
}

#[tokio::test]
async fn other_users_routine_does_not_fire_for_me() {
    let (state, mut rx) = test_state().await;
    add_user(&state, 2, "other").await;
    let gid = seed_goal(&state, 2, "남의 목표", &[]).await;
    seed_routine(&state, 2, gid, &now_hhmm(), pure::DAILY_MASK).await;

    routines_tick(&state, USER).await.unwrap();
    assert!(rx.try_recv().is_err(), "남의 루틴이 내 tick에서 발화됐다");
}

// ===== 발화 =====

#[tokio::test]
async fn routine_fires_once_and_dedups_within_the_same_day() {
    let (state, mut rx) = test_state().await;
    let gid = seed_goal(&state, USER, "영어 회화", &["통역 없이 미팅하려고"]).await;
    seed_routine(&state, USER, gid, &now_hhmm(), pure::DAILY_MASK).await;

    routines_tick(&state, USER).await.unwrap();
    let msg = rx.try_recv().expect("첫 tick에서 발화해야 한다");
    assert_eq!(msg.name, "routine.fired");
    assert_eq!(msg.data["goal_title"], "영어 회화");
    // 키가 없으므로 LLM을 타지 않고 폴백으로 나가야 한다(테스트가 네트워크를 때리면 안 됨).
    assert_eq!(msg.data["generated"], false);
    assert!(msg.data["message"].as_str().unwrap().contains("영어 회화"));

    // 두 번째 tick — 같은 날이면 다시 나가면 안 된다.
    routines_tick(&state, USER).await.unwrap();
    assert!(rx.try_recv().is_err(), "같은 날 두 번 발화됐다");
    assert_eq!(
        count(&state, "SELECT COUNT(*) FROM routine_notifications_sent").await,
        1
    );
}

/// 이번 설계의 핵심 요구사항. `tick()`은 DND면 함수 전체를 early return 하므로 루틴을 그 안에
/// 넣었다면 여기서 깨진다.
#[tokio::test]
async fn routine_fires_even_while_dnd_is_on() {
    let (state, mut rx) = test_state().await;
    set_setting(&state, USER, "notifications.dnd_enabled", "true").await;
    set_setting(&state, USER, "notifications.dnd_start", "00:00").await;
    set_setting(&state, USER, "notifications.dnd_end", "23:59").await;

    let gid = seed_goal(&state, USER, "밤 루틴", &[]).await;
    seed_routine(&state, USER, gid, &now_hhmm(), pure::DAILY_MASK).await;

    routines_tick(&state, USER).await.unwrap();
    assert_eq!(
        rx.try_recv().expect("DND 중에도 발화해야 한다").name,
        "routine.fired"
    );
}

/// DND는 통과하지만 마스터 스위치는 존중한다 — "알림 전부 끄기"를 눌렀는데 루틴만 울리면 버그.
#[tokio::test]
async fn routine_silent_when_notifications_master_switch_off() {
    let (state, mut rx) = test_state().await;
    set_setting(&state, USER, "notifications.enabled", "false").await;

    let gid = seed_goal(&state, USER, "영어", &[]).await;
    seed_routine(&state, USER, gid, &now_hhmm(), pure::DAILY_MASK).await;

    routines_tick(&state, USER).await.unwrap();
    assert!(rx.try_recv().is_err(), "마스터 스위치가 꺼졌는데 발화됐다");
}

#[tokio::test]
async fn routine_does_not_fire_on_a_different_weekday() {
    let (state, mut rx) = test_state().await;
    let gid = seed_goal(&state, USER, "영어", &[]).await;
    seed_routine(&state, USER, gid, &now_hhmm(), tomorrow_only_mask()).await;

    routines_tick(&state, USER).await.unwrap();
    assert!(rx.try_recv().is_err(), "오늘이 아닌 요일에 발화됐다");
}

#[tokio::test]
async fn disabled_routine_does_not_fire() {
    let (state, mut rx) = test_state().await;
    let gid = seed_goal(&state, USER, "영어", &[]).await;
    let rid = seed_routine(&state, USER, gid, &now_hhmm(), pure::DAILY_MASK).await;
    routine_update(
        &state,
        USER,
        rid,
        RoutinePatch {
            time_hhmm: None,
            days_mask: None,
            enabled: Some(false),
        },
    )
    .await
    .unwrap();

    routines_tick(&state, USER).await.unwrap();
    assert!(rx.try_recv().is_err(), "꺼둔 루틴이 발화됐다");
}

#[tokio::test]
async fn fired_nudge_is_recorded_in_messages_with_source_tag() {
    let (state, mut rx) = test_state().await;
    let gid = seed_goal(&state, USER, "영어", &["이유"]).await;
    seed_routine(&state, USER, gid, &now_hhmm(), pure::DAILY_MASK).await;

    routines_tick(&state, USER).await.unwrap();
    let _ = rx.try_recv();

    assert_eq!(
        count(
            &state,
            "SELECT COUNT(*) FROM messages WHERE source = 'routine_nudge'"
        )
        .await,
        1
    );
    // 실제 대화(source IS NULL)와 분리 가능해야 나중에 컨텍스트 선별을 붙일 수 있다.
    assert_eq!(
        count(&state, "SELECT COUNT(*) FROM messages WHERE source IS NULL").await,
        0
    );
}

// ===== 브리핑 줄 =====

#[tokio::test]
async fn briefing_lines_include_only_todays_routines() {
    let (state, _rx) = test_state().await;
    let a = seed_goal(&state, USER, "오늘 것", &["이유A"]).await;
    seed_routine(&state, USER, a, "07:00", pure::DAILY_MASK).await;

    let b = seed_goal(&state, USER, "내일 것", &[]).await;
    seed_routine(&state, USER, b, "08:00", tomorrow_only_mask()).await;

    let lines = briefing_lines(&state, USER).await.unwrap();
    assert_eq!(lines.len(), 1, "오늘 해당하는 루틴만 나와야 한다: {lines:?}");
    assert!(lines[0].contains("오늘 것"));
    assert!(lines[0].contains("07:00"));
    assert!(lines[0].contains("이유A"));
}

#[tokio::test]
async fn goal_without_any_routine_still_shows_in_briefing() {
    let (state, _rx) = test_state().await;
    seed_goal(&state, USER, "루틴 없는 목표", &["이유"]).await;

    let lines = briefing_lines(&state, USER).await.unwrap();
    assert_eq!(lines.len(), 1, "만들었는데 아무 데도 안 보이면 이상하다");
    assert!(lines[0].contains("루틴 없는 목표"));
}

#[tokio::test]
async fn briefing_lines_sorted_by_time() {
    let (state, _rx) = test_state().await;
    let a = seed_goal(&state, USER, "밤", &[]).await;
    seed_routine(&state, USER, a, "22:00", pure::DAILY_MASK).await;
    let b = seed_goal(&state, USER, "아침", &[]).await;
    seed_routine(&state, USER, b, "7:00", pure::DAILY_MASK).await;

    let lines = briefing_lines(&state, USER).await.unwrap();
    assert_eq!(lines.len(), 2);
    assert!(lines[0].contains("아침"), "정규화 없으면 순서가 뒤집힌다: {lines:?}");
    assert!(lines[1].contains("밤"));
}

// ===== 이정표 =====

async fn seed_with_milestones(state: &AppState, titles: &[&str]) -> i64 {
    let g = create(
        state,
        USER,
        GoalDraft {
            title: "논문 마무리".into(),
            target_ym: Some("2026. 12.".into()),
            whys: vec![],
            milestones: titles
                .iter()
                .map(|t| MilestoneDraft {
                    id: None,
                    title: (*t).into(),
                })
                .collect(),
        },
    )
    .await
    .expect("목표 생성");
    g.id
}

#[tokio::test]
async fn 이정표는_순서대로_저장되고_진행률은_0에서_시작() {
    let (state, _rx) = test_state().await;
    let gid = seed_with_milestones(&state, &["초안", "1차 수정", "제출"]).await;

    let g = &list(&state, USER).await.unwrap()[0];
    assert_eq!(g.id, gid);
    assert_eq!(
        g.milestones.iter().map(|m| m.title.as_str()).collect::<Vec<_>>(),
        vec!["초안", "1차 수정", "제출"]
    );
    assert_eq!(g.progress, 0);
    assert_eq!(g.target_ym.as_deref(), Some("2026. 12."));
}

#[tokio::test]
async fn 이정표_토글이_진행률을_움직인다() {
    let (state, _rx) = test_state().await;
    let gid = seed_with_milestones(&state, &["초안", "1차 수정", "제출"]).await;
    let first = list(&state, USER).await.unwrap()[0].milestones[0].id;

    let g = milestone_toggle(&state, USER, first, true).await.unwrap();
    assert_eq!(g.progress, 33, "3개 중 1개 = 33% (내림)");
    assert!(g.milestones[0].done);
    assert!(g.milestones[0].done_at.is_some());

    let g = milestone_toggle(&state, USER, first, false).await.unwrap();
    assert_eq!(g.progress, 0);
    assert!(g.milestones[0].done_at.is_none(), "해제하면 달성 시각도 지운다");

    // 목표 id를 안 넘겨도 이정표 id만으로 올바른 목표를 되돌려준다.
    assert_eq!(g.id, gid);
}

/// 이번 설계의 핵심 불변식 — 제목 한 글자 고치는 편집에 달성 기록이 날아가면 안 된다.
#[tokio::test]
async fn 편집_저장이_이정표_달성을_보존한다() {
    let (state, _rx) = test_state().await;
    let gid = seed_with_milestones(&state, &["초안", "1차 수정", "제출"]).await;
    let ms = list(&state, USER).await.unwrap()[0].milestones.clone();
    milestone_toggle(&state, USER, ms[0].id, true).await.unwrap();

    // 두 번째 제목만 고치고, 세 번째는 지우고, 새 항목을 하나 붙인다.
    let g = update(
        &state,
        USER,
        gid,
        GoalDraft {
            title: "논문 마무리".into(),
            target_ym: None,
            whys: vec![],
            milestones: vec![
                MilestoneDraft { id: Some(ms[0].id), title: "초안".into() },
                MilestoneDraft { id: Some(ms[1].id), title: "2차 수정".into() },
                MilestoneDraft { id: None, title: "심사".into() },
            ],
        },
    )
    .await
    .unwrap();

    assert!(g.milestones[0].done, "달성 상태가 보존돼야 한다");
    assert_eq!(
        g.milestones.iter().map(|m| m.title.as_str()).collect::<Vec<_>>(),
        vec!["초안", "2차 수정", "심사"]
    );
    assert_eq!(g.progress, 33, "3개 중 1개");
    assert_eq!(g.target_ym, None, "빈 목표 시점은 null로 지워진다");
}

#[tokio::test]
async fn 목표를_지우면_이정표도_같이_지워진다() {
    let (state, _rx) = test_state().await;
    let gid = seed_with_milestones(&state, &["초안", "제출"]).await;
    assert_eq!(count(&state, "SELECT COUNT(*) FROM goal_milestones").await, 2);

    delete(&state, USER, gid).await.unwrap();
    assert_eq!(count(&state, "SELECT COUNT(*) FROM goal_milestones").await, 0);
}

#[tokio::test]
async fn 남의_이정표는_토글할_수_없다() {
    let (state, _rx) = test_state().await;
    add_user(&state, 2, "user2").await;
    let _ = seed_with_milestones(&state, &["초안"]).await;
    let mid = list(&state, USER).await.unwrap()[0].milestones[0].id;

    assert!(milestone_toggle(&state, 2, mid, true).await.is_err());
    assert!(!list(&state, USER).await.unwrap()[0].milestones[0].done);
}
