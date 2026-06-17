# Chat Agent Tools

기록 시점: 2026-06-17.
대상: 제품의 **메인 채팅 에이전트**(Core의 `chat_send` → `run_agent_loop`, 모델 `gpt-5-mini`)가
LLM에 노출하는 tool 세트와 그 실행 메커니즘.

> 이건 우리 **제품**의 채팅 에이전트 얘기다. Claude Code(개발 도구)가 쓰는 tool과는 무관.

관련 코드
- 도구 정의: `core/src/services/llm/tools.rs` (`default_toolset()`)
- 실행/분기: `core/src/services/llm/dispatch.rs` (`is_read_only` / `execute_tool` / `execute_write_tool`)
- agent loop: `core/src/commands/chat.rs` (`run_agent_loop`, `chat_continue`)

---

## 도구 목록 (14개)

### Todo (할 일)
| tool | 종류 | 설명 |
|---|---|---|
| `list_todos` | 읽기 | todo 앱의 할 일 목록 조회 (캘린더 일정 아님). `include_done` 선택 |
| `create_todo` | 쓰기 | 새 할 일 생성. `title` 필수, `notes`/`due_at`/`priority`/`estimated_minutes` 선택 |
| `complete_todo` | 쓰기 | `id`로 완료 처리 |
| `delete_todo` | 쓰기 | `id`로 삭제 (잘못 만든 항목 제거용) |

### 캘린더 (Google Calendar 일정)
| tool | 종류 | 설명 |
|---|---|---|
| `list_today_events` | 읽기 | 오늘 일정(미팅·약속) |
| `list_upcoming_events` | 읽기 | 다가오는 N일 일정. `days` 미지정 시 7 |
| `list_today_overview` | 읽기 | 오늘 할 일 + 일정을 **한 번에** 묶어 반환 (두 번 호출 절약) |
| `create_event` | 쓰기 | 일정 생성. 생성 전 충돌 조회를 프롬프트로 강제 |
| `update_event` | 쓰기 | 일정 일부 수정 (준 필드만 패치, 시간 변경 시 충돌 확인) |
| `delete_event` | 쓰기 | `google_event_id`로 삭제 |

### 일과 자동 배치
| tool | 종류 | 설명 |
|---|---|---|
| `suggest_schedule` | 읽기 | 빈 시간에 할 일 배치 **추천만** (실제 생성 X) |
| `schedule_commit` | 쓰기 | 사용자가 추천을 수락하면 실제 캘린더 이벤트로 생성 |

### 장기 메모리
| tool | 종류 | 설명 |
|---|---|---|
| `search_memory` | 읽기 | 사용자 사실 키워드 검색 |
| `remember_fact` | 쓰기 | 재사용 가치 있는 사용자 사실 저장 (일회성 정보는 저장 X) |

---

## 실행 메커니즘

### 1. 읽기/쓰기 도구 구분 (`dispatch.rs::is_read_only`)
- **읽기 도구**(6개: `list_todos`, `list_today_events`, `list_upcoming_events`,
  `list_today_overview`, `suggest_schedule`, `search_memory`)
  → agent loop이 `execute_tool`로 **자동 실행**, 결과를 history에 넣고 다음 iteration.
- **쓰기 도구**(8개) → 절대 자동 실행 안 함. `pending tool`로 클라이언트에 반환
  → **UI/봇에서 사용자 confirm** → `chat_continue`(`approved`)가 오면 Core가
  `execute_write_tool`로 직접 실행(4b: 모든 클라이언트는 승인/거절만 전송).

### 2. agent loop (`run_agent_loop`, 최대 `MAX_AGENT_ITERATIONS`=4)
- LLM 응답의 tool_call들을 앞에서부터 훑어 prefix를 자른다:
  앞쪽 read-only는 다 포함, 첫 write를 만나면 거기까지 포함하고 중단.
  prefix 뒤의 tool_call은 폐기(필요하면 다음 턴에 LLM이 재호출).
- tool_call 없이 텍스트만 나오면 종료.
- LLM 호출 인자(`ChatRequest.tools`)에 매 iteration `default_toolset()`를 넘긴다.

### 3. 표시 지침 주입 (`chat.rs::PRESENT_HINTS`)
- `list_today_overview`, `list_today_events`, `list_upcoming_events`, `list_todos`,
  `suggest_schedule` 결과는 **방금 생성된 그 iteration에만** 포맷 지침(시각 변환·구조)을
  결과에 동봉(`_present` 필드). system 프롬프트에 넣지 않아 일상 대화로 누수/누적되지 않게 함.

### 4. 비용·테넌시 가드
- 매 턴 일일 비용 한도 체크(`enforce_daily_cap`), `cost_ledger`에 토큰/비용 기록.
- 모든 도구는 `user_id`를 받아 멀티테넌트 분리 (cloud-brain 테넌시 방향과 일치).

---

## 도구 추가 시 체크리스트
1. `tools.rs`에 `ToolDef` 정의 + `default_toolset()`에 등록.
2. 읽기면 `dispatch::is_read_only`에 추가 + `execute_tool` arm.
   쓰기면 `execute_write_tool` arm (flat 인자 → 커맨드 구조체 어댑팅은 여기 한 곳).
3. 표시 포맷이 필요하면 `chat.rs::PRESENT_HINTS`에 힌트 매핑.
4. 실제 동작은 `core/src/commands/*` · `core/src/services/*`의 기존 커맨드 재사용.
