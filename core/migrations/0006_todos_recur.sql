-- 반복 todo(루틴) 지원. null = 일회성, 'daily' | 'weekly' | 'monthly'.
-- 반복 todo는 완료 시 done=1로 끝나지 않고 due_at을 다음 주기로 전진시켜 재등장한다.
ALTER TABLE todos ADD COLUMN recur TEXT;
