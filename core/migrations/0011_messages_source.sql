-- 메시지 출처 표시. null = 사용자와 주고받은 실제 대화(기본값).
-- 'briefing'  = 아침 브리핑 한마디
-- 'routine_nudge' = 목표 루틴 알림 문구
--
-- 왜 필요한가: 브리핑·알림 문구도 messages에 쌓이는데, 이들은 chat history를 통해 LLM
-- 컨텍스트로 다시 들어간다. 나중에 RAG/컨텍스트 선별을 붙일 때 `WHERE source IS NULL`로
-- 실제 대화만 고를 수 있어야 한다. 컬럼 없이 두면 그때까지 쌓인 데이터를 되돌려 분리할
-- 방법이 없다(내용만 보고는 구분 불가).
ALTER TABLE messages ADD COLUMN source TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_user_source ON messages(user_id, source);
