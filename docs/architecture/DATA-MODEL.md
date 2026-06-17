# 데이터 모델

기록 시점: 2026-06-17.
**진실은 `core/migrations/*.sql`** (sqlx::migrate!). 이 문서는 테이블/관계 개요와
주의점만 요약한다 — 컬럼 변경 시 마이그레이션이 단일 출처이고 이 문서는 따라온다.

엔진: SQLite. 위치: `%APPDATA%\dev.ohmyhong.personalassistant\pa.sqlite` (Win) /
`~/Library/Application Support/dev.ohmyhong.personalassistant/pa.sqlite` (Mac).

---

## 멀티테넌시 (중요)

- 마이그레이션 **0008**(D-013)에서 전 테이블에 `user_id` 도입. 공유 Core 한 프로세스가 전 유저 처리.
- 기존 데이터는 `user_id = 1`('local')로 백필. `users(id=1, handle='local')`.
- SQLite는 PK/UNIQUE 변경이 불가 → 복합키가 필요한 테이블(`settings`·`sync_state`·`briefings`·`events`)은
  `*_new` 재생성 후 RENAME으로 전환했다. **새 쿼리는 반드시 `user_id`로 필터**할 것.
- 예외: OAuth/Google 연결은 v0에서 플랫폼 전역(단일 계정) — `user_id` 비관여(`main.rs` 주석).

## 테이블 한눈에

| 테이블 | 용도 | 테넌시 키 | 비고 |
|---|---|---|---|
| `users` | 테넌트 | `id` PK | `handle` UNIQUE. id=1='local' |
| `events` | 캘린더 이벤트(Google 동기화) | `(user_id, google_event_id)` UNIQUE | `start_at`/`end_at`은 UTC RFC3339 |
| `todos` | 할 일 | `user_id` | `recur`(daily/weekly/monthly), `estimated_minutes` |
| `messages` | 채팅 history | `(user_id, conversation_id, ts)` | `role`/`tool_call_id`/`tool_name`/`tool_calls_json` |
| `memories` | 장기 메모리(사용자 사실) | `user_id` | `content`/`tags`/`last_used_at` |
| `settings` | 키-값 설정 | `(user_id, key)` PK | 복합키 전환됨 |
| `sync_state` | 동기화 토큰 | `(user_id, provider)` PK | 캘린더 incremental sync |
| `briefings` | 일일 브리핑 캐시 | `(user_id, date)` UNIQUE | `summary`/`audio_path` |
| `cost_ledger` | LLM/음성 비용 원장 | `(user_id, ts)` | `kind`·`model`·토큰·`audio_seconds`·`chars`·`cost_usd` |
| `notifications_sent` | 알림 중복 방지 | `(event_id, kind)` PK | ⚠️ user_id 없음(이벤트 종속) |

## 도메인 메모

### events
- `google_event_id` NULL 허용(로컬 생성 후 동기화 전). UNIQUE는 `(user_id, google_event_id)`.
- 시각은 전부 UTC 저장 → 표시 시 사용자 타임존으로 변환(채팅 표시 지침이 강제).
- 인덱스: `idx_events_user_start_at(user_id, start_at)`, `idx_events_status`.

### todos
- `recur` = null이면 일회성. 'daily'|'weekly'|'monthly'면 완료 시 `done=1`로 끝나지 않고
  `due_at`을 다음 주기로 전진시켜 재등장(루틴). — 마이그레이션 0006.
- `estimated_minutes` = 일과 자동 배치(`suggest_schedule`)의 핵심 입력. null=미입력.
- `priority` 0~3, `done`/`done_at`.

### messages
- OpenAI 대화 프로토콜 보존용. `role` = system/user/assistant/tool.
- assistant의 tool_calls는 `tool_calls_json`(0003), tool 결과는 `tool_call_id`+`tool_name`로 연결.
- orphan tool_call(컨펌 없이 다음 메시지) 정합성은 `chat.rs::close_orphan_tool_calls`가 처리.

### cost_ledger
- `kind` = 'chat' | 'speech' 등 비용 종류. `model`(0002)·토큰/오디오/문자 단위 혼재.
- 일일 한도 enforce(`chat.rs::enforce_daily_cap`)와 `cost_summary`가 이 테이블을 집계.
- ⚠️ 테넌트 안전 잔여: speech 비용은 `user_id` 명시 주입 필요(현재 일부 DEFAULT 1 의존 —
  [SAAS-LAUNCH-PLAN.md](../design/SAAS-LAUNCH-PLAN.md) "다음 우선순위" 참조).

## 마이그레이션 이력

| 파일 | 내용 |
|---|---|
| 0001_init | events·todos·messages·settings·sync_state·briefings·cost_ledger |
| 0002_cost_model | `cost_ledger.model` 추가 |
| 0003_messages_tool_calls | `messages.tool_calls_json` 추가 |
| 0004_memories | `memories` 테이블 |
| 0005_notifications | `notifications_sent`(이벤트 알림 중복 방지) |
| 0006_todos_recur | `todos.recur`(루틴) |
| 0007_todos_estimated | `todos.estimated_minutes`(자동 배치 입력) |
| 0008_tenancy | `users` + 전 테이블 `user_id`, 복합키 전환 (D-013) |
