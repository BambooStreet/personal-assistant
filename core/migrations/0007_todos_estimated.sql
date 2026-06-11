-- 할 일 예상 소요시간(분). null = 미입력. 일과 자동 배치(빈 슬롯 채우기)의 핵심 입력.
ALTER TABLE todos ADD COLUMN estimated_minutes INTEGER;
