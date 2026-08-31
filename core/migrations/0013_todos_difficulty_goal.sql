-- 할 일에 난이도 + 연결된 목표.
--
-- 리디자인의 할 일 화면이 칩으로 보여주는 두 가지다. 소요시간(estimated_minutes, 0007)과
-- 반복(recur, 0006)은 이미 있다.
--
-- difficulty는 정수 등급이 아니라 문자열 '하'|'중'|'상'이다. 정수로 두면 "3이 상인가 하인가"를
-- 양쪽에서 기억해야 하고, 등급이 늘거나 이름이 바뀌면 매핑이 또 생긴다. 지금 이 값으로
-- 계산하는 건 없고 칩에 그대로 찍기만 한다.
--
-- goal_id는 FK를 걸지 않는다(이 스키마의 관례). 목표가 지워지면 고아 참조가 남는데,
-- 읽는 쪽이 goals에 없는 id를 만나면 그냥 연결 없음으로 취급한다 — 할 일까지 같이
-- 지우는 건 과하다(목표를 접었다고 그 할 일이 사라지면 곤란하다).

ALTER TABLE todos ADD COLUMN difficulty TEXT;
ALTER TABLE todos ADD COLUMN goal_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_todos_user_goal ON todos(user_id, goal_id);
