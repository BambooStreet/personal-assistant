//! 인사의 DB 통합 테스트. 순수 로직은 `pure.rs`에, 여기는 **DB가 있어야만** 검증되는 것들 —
//! 쿨다운 클레임, 아침 창 게이팅, 이벤트 발화, 테넌시 격리, LLM 프롬프트 내용.
//!
//! 시각 의존 주의: `run`은 내부에서 `Local::now()`를 쓴다. 그래서 아침 창 테스트는
//! **지금 이 순간을 포함/제외하는 창**을 계산해서 넣는다 — 고정 "05:00~13:00"으로 잡으면
//! 테스트가 도는 시각에 따라 결과가 바뀐다.

use chrono::{Duration, Local, Timelike};

use super::*;
use crate::testing::{
    add_user, count, llm_text, set_setting, test_state, test_state_with_llm_and_key,
};

const USER: i64 = 1;

/// 지금을 포함하는 창 / 지금을 제외하는 창. 자정 근처에서도 안전하도록 시각 산술로 만든다.
fn window_around_now(include: bool) -> (String, String) {
    let now = Local::now();
    let fmt = |d: chrono::DateTime<Local>| d.format("%H:%M").to_string();
    if include {
        // [지금-2h, 지금+2h) — 지금이 항상 안에 들어온다(자정을 넘기면 넘긴 창으로 해석된다).
        (fmt(now - Duration::hours(2)), fmt(now + Duration::hours(2)))
    } else {
        // [지금+2h, 지금+4h) — 지금은 밖.
        (fmt(now + Duration::hours(2)), fmt(now + Duration::hours(4)))
    }
}

async fn set_window(state: &AppState, user_id: i64, include_now: bool) {
    let (s, e) = window_around_now(include_now);
    set_setting(state, user_id, WINDOW_START_KEY, &s).await;
    set_setting(state, user_id, WINDOW_END_KEY, &e).await;
}

async fn greeting_count(state: &AppState) -> i64 {
    count(
        state,
        "SELECT COUNT(*) FROM messages WHERE source = 'greeting'",
    )
    .await
}

// ===== 인사 자체 =====

/// 키가 없어도 **반드시** 인사한다. 폴백을 빼먹으면 로컬 사용자에겐 앱이 벙어리가 된다.
#[tokio::test]
async fn 키가_없어도_인사는_나간다() {
    let (state, _rx) = test_state().await;
    set_window(&state, USER, false).await; // 브리핑은 끼우지 않는다

    let out = run(&state, USER, false).await.expect("인사");

    assert!(out.greeted);
    assert!(!out.generated, "키가 없으므로 폴백이어야 한다");
    assert!(!out.text.unwrap().trim().is_empty());
    assert_eq!(greeting_count(&state).await, 1);
}

#[tokio::test]
async fn 쿨다운_안에_다시_부르면_건너뛴다() {
    let (state, _rx) = test_state().await;
    set_window(&state, USER, false).await;

    assert!(run(&state, USER, false).await.unwrap().greeted);

    let second = run(&state, USER, false).await.unwrap();
    assert!(!second.greeted);
    assert!(second.text.is_none());
    assert_eq!(greeting_count(&state).await, 1, "말풍선이 늘면 안 된다");
}

#[tokio::test]
async fn 쿨다운이_지나면_다시_인사한다() {
    let (state, _rx) = test_state().await;
    set_window(&state, USER, false).await;
    run(&state, USER, false).await.unwrap();

    // 기준선을 쿨다운보다 더 과거로 되돌린다(시계를 못 돌리므로 저장값을 손본다).
    let long_ago = fmt_utc_z(Local::now().to_utc() - Duration::hours(COOLDOWN_PLUS));
    set_setting(&state, USER, LAST_GREETED_KEY, &long_ago).await;

    assert!(run(&state, USER, false).await.unwrap().greeted);
    assert_eq!(greeting_count(&state).await, 2);
}

const COOLDOWN_PLUS: i64 = pure::COOLDOWN_HOURS + 1;

#[tokio::test]
async fn force는_쿨다운을_무시한다() {
    let (state, _rx) = test_state().await;
    set_window(&state, USER, false).await;

    run(&state, USER, false).await.unwrap();
    assert!(run(&state, USER, true).await.unwrap().greeted);
    assert_eq!(greeting_count(&state).await, 2);
}

#[tokio::test]
async fn 인사하면_이벤트가_발화된다() {
    let (state, mut rx) = test_state().await;
    set_window(&state, USER, false).await;

    run(&state, USER, false).await.unwrap();

    let ev = rx.try_recv().expect("greeting.fired");
    assert_eq!(ev.name, "greeting.fired");
    assert!(!ev.data["text"].as_str().unwrap().is_empty());
}

/// 유저별로 쿨다운이 독립이어야 한다 — 한 사람이 인사받았다고 다른 사람이 조용해지면 안 된다.
#[tokio::test]
async fn 쿨다운은_유저별로_독립이다() {
    let (state, _rx) = test_state().await;
    add_user(&state, 2, "user2").await;
    set_window(&state, USER, false).await;
    set_window(&state, 2, false).await;

    assert!(run(&state, USER, false).await.unwrap().greeted);
    assert!(run(&state, 2, false).await.unwrap().greeted);
    assert_eq!(
        count(
            &state,
            "SELECT COUNT(*) FROM messages WHERE source = 'greeting' AND user_id = 1"
        )
        .await,
        1
    );
}

// ===== 아침 창 =====

#[tokio::test]
async fn 아침_창_밖이면_브리핑이_없다() {
    let (state, _rx) = test_state().await;
    set_window(&state, USER, false).await;

    let out = run(&state, USER, false).await.unwrap();

    assert!(out.greeted, "브리핑이 없어도 인사는 나간다");
    assert!(out.briefing.is_none());
    assert!(!out.briefing_created);
    assert_eq!(count(&state, "SELECT COUNT(*) FROM briefings").await, 0);
}

/// 창 안이면 브리핑을 **시도**한다. 이 하네스엔 키가 없어서 생성은 실패하는데,
/// 그 실패가 인사까지 끌고 내려가지 않는다는 게 여기서 확인할 불변식이다.
#[tokio::test]
async fn 아침_창_안에서_브리핑_실패는_인사를_막지_않는다() {
    let (state, _rx) = test_state().await;
    set_window(&state, USER, true).await;

    let out = run(&state, USER, false).await.unwrap();

    assert!(out.greeted);
    assert!(out.briefing.is_none(), "키가 없으니 생성은 실패한다");
    assert_eq!(greeting_count(&state).await, 1);
}

// ===== LLM 경로 =====

#[tokio::test]
async fn llm_문구를_쓰고_프롬프트에는_일정이_실리지_않는다() {
    let (state, _rx, llm) = test_state_with_llm_and_key(vec![llm_text("또 봐요, 지훈님!")]).await;
    set_window(&state, USER, false).await;
    set_setting(&state, USER, "user.name", "지훈").await;

    let out = run(&state, USER, false).await.unwrap();

    assert!(out.generated);
    assert_eq!(out.text.as_deref(), Some("또 봐요, 지훈님!"));

    // 프롬프트에 무엇이 실렸는지 검증 — D-024가 FakeLlm에 요청 보관을 넣은 이유.
    let req = llm.request(0);
    let sent: String = req
        .messages
        .iter()
        .filter_map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(sent.contains("지훈님"), "이름이 안 실림");
    assert!(
        sent.contains(pure::time_slot(Local::now().hour()).label()),
        "시간대가 안 실림"
    );
    // 요구사항의 핵심 — 인사 프롬프트에는 할 일·일정을 아예 넣지 않는다.
    for banned in ["오늘 일정", "미완료 할 일"] {
        assert!(!sent.contains(banned), "인사 프롬프트에 {banned}이(가) 실림");
    }
}

#[tokio::test]
async fn llm이_실패해도_폴백으로_나간다() {
    // 대본이 비어 있으므로 FakeLlm이 "대본 소진" 에러를 낸다.
    let (state, _rx, _llm) = test_state_with_llm_and_key(vec![]).await;
    set_window(&state, USER, false).await;

    let out = run(&state, USER, false).await.unwrap();

    assert!(out.greeted);
    assert!(!out.generated);
    assert!(!out.text.unwrap().trim().is_empty());
}

// ===== 채팅 컨텍스트 =====

/// 인사가 쌓여도 LLM 컨텍스트에는 마지막 1건만 들어간다(D-025).
#[tokio::test]
async fn 인사는_최근_1건만_컨텍스트에_들어간다() {
    let (state, _rx) = test_state().await;
    set_window(&state, USER, false).await;

    for i in 0..3 {
        let long_ago = fmt_utc_z(Local::now().to_utc() - Duration::hours(COOLDOWN_PLUS * (3 - i)));
        set_setting(&state, USER, LAST_GREETED_KEY, &long_ago).await;
        run(&state, USER, false).await.unwrap();
    }
    assert_eq!(greeting_count(&state).await, 3);

    let ctx = crate::commands::chat::load_recent_messages(&state.db, USER, "default", 40)
        .await
        .unwrap();
    let greetings = ctx
        .iter()
        .filter(|m| m.role == "assistant" && m.content.is_some())
        .count();
    assert_eq!(greetings, 1, "컨텍스트에 인사가 {greetings}건 들어감");
}
