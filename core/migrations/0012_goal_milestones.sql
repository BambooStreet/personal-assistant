-- 목표 이정표(milestones) + 목표 시점.
--
-- 0010에서 "진척률·스트릭·완료추적은 의도적으로 뺐다 — 매일 오는 알림이 실제로 먹히는지부터
-- 검증한다"고 적었다. 그 검증이 끝났고(루틴 알림은 배포돼 돌고 있다) 리디자인이 이정표를
-- 목표 화면의 중심으로 삼았으므로 그 판단을 뒤집는다. [D-026]
--
-- 진행률은 컬럼으로 두지 않는다 — 완료 이정표/전체로 **읽을 때마다 계산**한다.
-- 저장하면 이정표를 지우거나 순서를 바꿀 때마다 동기화 대상이 하나 더 생긴다
-- (goal_lines를 캐시하지 않은 것과 같은 이유).
--
-- FK는 이 스키마의 관례대로 선언하지 않는다 — 삭제 캐스케이드는 services/goals/mod.rs가
-- 수동 처리한다(순서: sent → routines → whys → milestones → goals).

CREATE TABLE IF NOT EXISTS goal_milestones (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL DEFAULT 1,
    goal_id    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    -- 달성 시각. done=0이면 NULL. 나중에 "언제 찍었나"를 보여줄 때를 위해 지금 남겨 둔다.
    done_at    TEXT,
    -- 표시 순서 = 산길 위 노드 순서. whys와 달리 **의미가 있는 순서**다(앞의 이정표를
    -- 먼저 밟는다는 전제) — 그래서 UNIQUE(goal_id, title) 같은 제약은 걸지 않는다.
    -- 같은 이름의 이정표를 여러 번 두는 게 이상하지 않다("1차 초안", "2차 초안"이 아니라
    -- "체중 -1kg"를 반복하는 식).
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_milestones_user_goal
    ON goal_milestones(user_id, goal_id, sort_order);

-- 목표 시점("2026. 12."). 자유 입력 문자열이다 — 날짜로 두면 "언젠가"를 표현할 수 없고,
-- 지금 이 값으로 계산하는 것도 없다(표시 전용).
ALTER TABLE goals ADD COLUMN target_ym TEXT;
