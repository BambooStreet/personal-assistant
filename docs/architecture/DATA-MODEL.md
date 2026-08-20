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
| `notifications_sent` | 일정 알림 중복 방지 | `(event_id, kind)` PK | ⚠️ user_id 없음(이벤트 종속) |
| `goals` | 장기 목표 | `user_id` | 제목만. 상태/진척 컬럼 없음(D-021) |
| `goal_whys` | 목표의 '왜' | `user_id` | `UNIQUE(goal_id, text)`. 알림에 날짜 기반으로 번갈아 실림 |
| `goal_routines` | 루틴(요일+시각) | `user_id` | `days_mask` 비트마스크, `UNIQUE(goal_id, time_hhmm, days_mask)` |
| `routine_notifications_sent` | 루틴 알림 중복 방지 | `(routine_id, date)` PK | `date`는 **로컬** YYYY-MM-DD |

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

### goals / goal_whys / goal_routines
- **`days_mask` = 요일 비트마스크. bit0=월 … bit6=일, 매일 = 127.** chrono
  `Weekday::num_days_from_monday()`와 일치해 변환이 없고, `(days_mask & ?) != 0`로 오늘치만
  질의한다. 별도 freq 컬럼이 없어 "daily인데 days도 채워짐" 모순이 불가능.
  ⚠️ 렌더러 `DateField`의 달력은 0=일 기준이라 규약이 다르다 — 요일 UI는 `LifestyleSection`(0=월).
- `time_hhmm`은 로컬 벽시계. Core가 저장 전 0을 채워 정규화한다("7:00" → "07:00") —
  안 그러면 `ORDER BY time_hhmm` 문자열 정렬에서 "7:00" > "22:00"이 된다.
- **FK가 없으므로 삭제 캐스케이드는 `services/goals::delete`가 수동 처리**한다.
  순서: `routine_notifications_sent` → `goal_routines` → `goal_whys` → `goals`
  (반대로 하면 routine_id를 알아낼 수 없다).
- 진척률·스트릭·완료 기록 컬럼은 **의도적으로 없다**(D-021).

### messages
- OpenAI 대화 프로토콜 보존용. `role` = system/user/assistant/tool.
- assistant의 tool_calls는 `tool_calls_json`(0003), tool 결과는 `tool_call_id`+`tool_name`로 연결.
- orphan tool_call(컨펌 없이 다음 메시지) 정합성은 `chat.rs::close_orphan_tool_calls`가 처리.
- **`source`(0011)** = 메시지 출처. `null` = 사용자와 주고받은 실제 대화(기본),
  `'briefing'` = 아침 한마디, `'routine_nudge'` = 목표 루틴 알림.
  브리핑·알림 문구도 이 테이블에 쌓이고 chat history를 통해 LLM 컨텍스트로 다시 들어가므로,
  나중에 컨텍스트 선별/RAG를 붙일 때 `WHERE source IS NULL`로 실제 대화만 고를 수 있게 한 태그.
  컬럼 없이 두면 그때까지 쌓인 데이터를 되돌려 분리할 방법이 없다(내용만으론 구분 불가).

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
| 0009_travel | `place_alias` + `geocode_cache`·`route_cache` (D-018) |
| 0010_goals | `goals`·`goal_whys`·`goal_routines`·`routine_notifications_sent` (D-021) |
| 0011_messages_source | `messages.source`(null=실제 대화 / briefing / routine_nudge) |
