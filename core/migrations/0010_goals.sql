-- 목표(goals) + 루틴 알림. 진척률·스트릭·완료추적은 의도적으로 뺐다 — 매일 오는 알림이
-- 실제로 먹히는지부터 검증한다.
-- 구조: goals 1:N goal_whys('왜'. 알림 문구에 날짜 기반으로 번갈아 실린다)
--             1:N goal_routines(요일 비트마스크 + 시각 한 점)
-- FK는 이 스키마의 다른 테이블과 마찬가지로 선언하지 않는다 — 삭제 캐스케이드는
-- services/goals.rs에서 수동 처리(순서 주의: sent → routines → whys → goals).
--
-- 요일 = 비트마스크. bit0=월, bit1=화 … bit6=일. '매일' = 127.
--   * chrono `Weekday::num_days_from_monday()`와 정확히 일치해 변환 코드가 없다.
--   * SQL에서 `(days_mask & ?) != 0`로 오늘치만 골라낼 수 있어 tick이 전체를 로드하지 않는다.
--   * 별도 freq 컬럼을 두지 않으므로 "freq=daily인데 days도 채워짐" 같은 모순이 불가능하다.
--   * ⚠️ 렌더러 `todos/DateField.tsx`의 달력은 0=일 기준이라 규약이 다르다.
--     요일 선택 UI는 반드시 `settings/LifestyleSection.tsx`(0=월)를 따를 것.
--
-- SQLite는 테이블 PK/UNIQUE를 나중에 변경할 수 없으므로 처음부터 잡는다.
-- (반면 CREATE UNIQUE INDEX는 나중에 추가 가능 — 확신이 없는 제약은 인덱스로 미룬다.)

CREATE TABLE IF NOT EXISTS goals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL DEFAULT 1,
    title      TEXT    NOT NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id, id);

-- 같은 목표에 같은 '왜'가 두 번 들어가면 로테이션에서 그 문구만 두 배로 나온다 → UNIQUE로 차단.
-- sort_order는 UI 표시 순서일 뿐(로테이션은 날짜 기반이라 순서와 무관).
CREATE TABLE IF NOT EXISTS goal_whys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL DEFAULT 1,
    goal_id    INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    UNIQUE (goal_id, text)
);
CREATE INDEX IF NOT EXISTS idx_goal_whys_user_goal ON goal_whys(user_id, goal_id, sort_order);

-- 루틴: 목표당 여러 개. time_hhmm은 로컬 벽시계 "HH:MM" 한 점(범위 아님).
-- days_mask 0 = 영원히 안 울리는 죽은 행이라 CHECK로 차단.
-- enabled는 v1에서 UI가 없다 — 루틴이 오작동할 때 DB 한 줄로 끌 수 있는 안전밸브.
CREATE TABLE IF NOT EXISTS goal_routines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL DEFAULT 1,
    goal_id    INTEGER NOT NULL,
    time_hhmm  TEXT    NOT NULL,
    days_mask  INTEGER NOT NULL CHECK (days_mask BETWEEN 1 AND 127),
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    UNIQUE (goal_id, time_hhmm, days_mask)
);
CREATE INDEX IF NOT EXISTS idx_goal_routines_user_enabled ON goal_routines(user_id, enabled);

-- 루틴 발화 디듑. 기존 notifications_sent는 PK가 (event_id, kind)라 캘린더 이벤트 전제 구조 —
-- 매일 같은 routine_id가 반복되는 걸 담을 수 없어 별도 테이블이 필요하다.
-- date는 발화 예정 시각의 **로컬** YYYY-MM-DD. UTC로 쓰면 KST 09:00 이전 루틴이 전날로 기록된다.
CREATE TABLE IF NOT EXISTS routine_notifications_sent (
    user_id    INTEGER NOT NULL DEFAULT 1,
    routine_id INTEGER NOT NULL,
    date       TEXT    NOT NULL,
    sent_at    TEXT    NOT NULL,
    PRIMARY KEY (routine_id, date)
);
CREATE INDEX IF NOT EXISTS idx_routine_sent_date ON routine_notifications_sent(date);
