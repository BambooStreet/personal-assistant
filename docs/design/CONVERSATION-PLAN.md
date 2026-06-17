# Conversation Rework Plan

기록 시점: 2026-05-05.
목표: **대화감 살리기** — 자연스럽고 연속성 있는 음성/채팅 대화 경험.

이 문서는 작업 단위로 구체화된 실행 계획. 큰 그림(ROADMAP)이 아니라 페이즈/작업 단위. 각 페이즈 끝마다 효과 체감 후 다음 페이즈 결정.

---

## 출발점 — 현재 진단

### Voice cycle (`apps/renderer/src/lib/voice/controller.ts`)
- 단발 사이클: `idle → wake → attentive → listening → thinking → speaking → idle`. 한 번 wake = 한 번 Q→A. 후속 질문하려면 다시 wake. **연속 대화 불가**.
- 캡처 파라미터: `silenceMs=1500`, `initialWaitMs=6000`, `maxDurationMs=30000`, `thresholdRms=0.04`.

### Chat 백엔드 (`core/src/commands/chat.rs`)
- 단일 conversation `"default"` 하드코딩. 최근 40턴 history.
- 시스템 프롬프트는 작음(현재 시각/타임존/한국어/1~3문장/모호하면 재질문). **사용자 이름이 없음** — LLM은 호칭을 모름.
- Daily cap 차단 있음.

### 도구 호출 — **반쪽 동작 (대화감 깨짐의 주범)**
- LLM은 4개 도구 정의 (`create_todo`, `complete_todo`, `list_todos`, `create_event`)를 보고 호출 가능.
- **그러나** UI(`apps/renderer/src/components/chat/ToolCallConfirmCard.tsx`)는 `create_todo`/`create_event`만 처리. `list_todos`/`complete_todo`는 "지원하지 않습니다" 카드.
- **더 심각**: 도구 실행 결과가 chat history에 **tool role 메시지로 저장 안 됨**. LLM은 자기가 호출한 도구가 실행됐는지/결과가 뭔지 모름.
- 결과: "오늘 할 일 뭐야?", "그 회의 시간 바꿔줘", "방금 운동 다 했어" 같은 자연 멀티스텝이 구조적으로 작동 못 함. (c) 없이는 (d) 메모리 RAG도 같은 이유로 깨짐.

### 인사 (`apps/renderer/src/lib/voice/greeting.ts`)
- "네, ○○님" TTS 메모리 캐시. wake 사이클의 attentive 단계에서만 사용.
- 시스템 시작/하루 첫 실행과 무관 — 그냥 매 wake마다 인사.

### 브리핑 (`core/src/services/briefing.rs`, `BriefingCard`)
- `bootstrapBriefing()`이 `{created: true}` 반환 시(= 그날 첫 생성) 패널 자동 오픈 + BriefingCard가 TTS auto-play.
- "하루 첫 실행" 시그널은 이미 자연 발생 (briefing 캐시가 날짜 키).

### 메모리
- 없음. 사용자 선호/사실 long-term 저장/주입 안 함.

---

## 사용자 추가 요구

1. **시스템 시작 시 자동 실행 / 하루 중 처음 실행** → 인사 + 하루 일정 브리핑 voice cycle. 매번 킬 때마다 X.
2. **메모리 시스템** → 일상 대화는 history만. 장기기억이 필요한 경우만 LLM이 tool-calling으로 RAG 호출. (auto-injection X)

---

## Phase α — 즉각 "느낌" 바뀌는 빠른 win

규모: 반나절~하루. 위험 낮음.

### 작업
1. **사용자 이름 system prompt 주입** (선택 후보 b)
   - `core/src/commands/chat.rs::build_system_prompt`이 `settings`에서 `user.name`을 읽어 "사용자 이름: ○○님" 한 줄 추가.
   - 이름 미설정 시 빈 라인 생략.
2. **첫 실행 인사+브리핑 voice cycle** (사용자 요구 #1)
   - `apps/renderer/src/AvatarApp.tsx`의 `bootstrapBriefing().then(res => res?.created)` 분기에서 기존 panel 오픈 대신/추가로 새 voice cycle 트리거.
   - VoiceController에 `speakSequence({greetingText, briefingText})` 같은 메서드 추가 — listening/thinking 스킵하고 speaking만 두 번.
   - 아바타 상태: idle → attentive(인사 TTS) → speaking(브리핑 TTS) → idle.
   - `BriefingCard` 자동 재생 flag(`pendingAutoPlay`)는 voice cycle 진입 시 `consumeAutoPlay()`로 소비 → 카드의 중복 재생 방지.

### 검증
- 사용자 이름 설정 후 채팅에서 "내 이름 알아?" → LLM이 정확히 호명.
- 캐시된 브리핑(같은 날 재실행)에선 voice cycle 안 뜸.
- 새 날(또는 강제 refresh) 첫 실행에서만 voice cycle 뜸.

### 지연 이슈
- 인사 + 브리핑 두 번의 TTS 호출 → ~3~6초 latency. 인사는 캐시되므로 두 번째 실행부터 짧음.
- 브리핑 TTS는 매번 새로 생성 (캐시 없음, 1.x 보류). 필요하면 인사처럼 메모리 캐시 추가 가능.

---

## Phase β — Tool 호출 루프 본격화

규모: 1~2일. 위험 중간 (chat.rs 핵심 변경).

### 작업
3. **chat agent loop** — `chat_send`를 단발 호출에서 루프로:
   - LLM 응답에 `tool_calls` 있으면 도구 실행 → 결과를 `tool` role 메시지로 history append → LLM 재호출 → text 응답까지 반복.
   - `max_iterations=4` 정도로 무한루프 방지 + 비용 cap.
   - 도구 결과는 `messages` 테이블에 `role='tool'`, `tool_call_id`, `tool_name`, `content`(JSON 직렬화) 저장.
4. **읽기 도구 자동 실행** — Renderer confirm 카드 거치지 않음:
   - `list_todos`, 신규 `list_today_events`, `list_upcoming_events` (선택).
   - core가 직접 SQL/calendar 호출 → 결과 즉시 LLM에 fed back.
   - UI는 "할 일 목록 확인 중..." 같은 small inline 표시 정도. 풍선은 LLM의 자연어 응답만.
5. **쓰기 도구는 현행 confirm 유지**:
   - `create_todo`, `complete_todo` (신규 confirm UI 필요), `create_event`, `delete_event` (신규).
   - 사용자 확정 → core 도구 실행 → 결과 fed back → LLM이 자연어 마무리("일정 잡았습니다").
   - 사용자 거부 → "tool 호출 거부됨" 메시지 fed back → LLM이 "알겠습니다" 류로 마무리.
6. **신규 도구 추가**:
   - `complete_todo` UI confirm (현재 LLM 호출 가능하나 UI 미지원)
   - `delete_todo`, `delete_event`
   - `list_today_events`, `list_upcoming_events(days)`
7. **`ToolCallConfirmCard` 일반화**:
   - 현재 `create_todo`, `create_event`만 처리. 새 쓰기 도구도 처리하도록 컴포넌트 확장 + 거부 시 LLM에 negative result fed back.

### 검증
- "오늘 할 일 뭐야?" → LLM이 `list_todos` 호출 → 결과 받아 "운동, 청소 두 개 있어요" 자연어 응답.
- "그 운동 다 했어" → LLM이 `list_todos` 호출 → id 식별 → `complete_todo(id)` 호출 → confirm → 완료 응답.
- "회식 취소됐어" → `list_today_events` → 이름 매칭 → `delete_event(google_event_id)` confirm → 취소 응답.

### 트레이드오프
- 한 사용자 발화 = 여러 LLM 호출 → 비용 ~2~4배 가능. Daily cap이 더 빨리 도달할 수 있음.
- Latency 누적: 사용자 → LLM(~2s) → tool exec(~0.1~1s) → LLM(~2s) → 최종 응답. 평균 4~6초.
- core 측 dispatch 코드 추가 (각 도구를 RPC로 부를 수 있도록 내부에서 직접 호출 또는 main으로 IPC 왕복). 처음엔 core 내부에서 직접 호출하는 게 단순.

---

## Phase γ — 연속 대화 + 마이크 튜닝

규모: 반나절~하루. 위험 낮음.

### 작업
8. **continuous voice cycle** (선택 후보 a):
   - VoiceController 상태머신에 `followup-listening` 단계 추가.
   - speaking 종료 후 idle 대신 짧은 wait로 listening 재진입: `silenceMs=1500`(같음), `initialWaitMs=4000`(짧음), `maxDurationMs=15000`(짧음).
   - initial wait 안에 음성 없으면 자연 idle 종료.
   - 음성 있으면 thinking → speaking → followup-listening 다시 (다음 턴).
   - 사용자가 "그만", "고마워" 같은 종료 의도 발화 시 LLM 응답에 종료 신호 도구 호출 추가? — 1차에서는 단순히 침묵 timeout만. 종료 도구는 (g) 페르소나 단계에서.
9. **마이크 튜닝 UI** (선택 후보 h):
   - `apps/renderer/src/components/voice/MicSettingsPanel.tsx`에 슬라이더 추가:
     - VAD threshold (0.01~0.10, default 0.04)
     - Silence ms (500~3000, default 1500)
     - Initial wait ms (3000~15000, default 6000 wake / 4000 followup)
   - 저장 키: `mic.threshold_rms`, `mic.silence_ms`, `mic.initial_wait_ms`, `mic.followup_initial_wait_ms`.
   - VoiceController/MicButton이 settings에서 읽어 사용.

### 검증
- "오늘 일정 뭐야?" → 응답 → 자연스럽게 "그러면 11시 회의 위치는?" 추가 → 응답 → 침묵 → idle.
- 잡음 환경에서 임계값 올려 잘못된 wake 감소 검증.

---

## Phase δ — 메모리 시스템

규모: 1~2일. 위험 중간.

전제: Phase β의 tool agent loop이 안정적으로 동작해야 함.

### 작업
10. **`memories` 테이블 + 마이그레이션 0003**:
    ```sql
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      tags TEXT,                 -- JSON 배열, 예: '["coffee", "preference"]'
      source_conversation TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE INDEX idx_memories_created_at ON memories(created_at);
    ```
    embedding 컬럼은 일단 도입 안 함 (LIKE/FTS5 키워드 검색부터). 추후 vector 확장 시 컬럼 추가.
11. **신규 도구 두 개**:
    - `remember_fact(content: string, tags?: string[])` — LLM이 "이건 기억해 둬야겠다" 판단 시 호출.
    - `search_memory(query: string, limit?: number = 3)` — LLM이 사용자 발화에서 "이전에 말한 거 있을 텐데" 싶을 때 호출.
12. **검색 구현**: 우선 LIKE `%query%` 검색 (다중 키워드는 OR). FTS5 도입은 다음 iteration.
13. **시스템 프롬프트에 가이드 추가**: "사용자 선호/사실은 자연스럽게 활용하되, 모르면 search_memory 호출. 새로 알게 된 안정적 사실은 remember_fact로 저장."

### 검증
- 한 세션에서 "나 커피는 안 마셔. 차 좋아해" → LLM이 `remember_fact("사용자는 커피 X, 차 좋아함", ["preference", "drink"])` 호출.
- 다른 날 "오후에 카페 갈까?" → LLM이 `search_memory("커피 차")` → 결과 보고 "차 좋아하시죠? 카페보다 티하우스 어떨까요?" 같은 응답.
- 일상 대화엔 search_memory 호출 안 함 (auto-inject 없음 = 비용 부담 없음).

### 보류
- **auto-extraction**: 매 turn에 가벼운 LLM으로 "기억할 만한가?" 판단 → 비용 부담. 1차에선 LLM이 명시적으로 `remember_fact` 호출하거나 사용자가 "이거 기억해줘" 할 때만.
- **embedding/vector search**: 메모리 100건 넘어가면 검토. 그 전엔 키워드로 충분.

---

## 보류 항목

### (g) 페르소나 커스터마이징 UI
α의 (1)이 동작하면 system prompt에 persona 텍스트 한 줄 더 주입하는 것까지 거저. 별도 UI는 사용 패턴 보고 결정.

### (i) 멀티 conversation thread
단일 default 스레드로 충분히 잘 돌아감. 진짜 컨텍스트 충돌이 보이면 그때.

### Auto-extract 메모리
δ의 옵션 부분 참고. 비용·복잡도 부담으로 명시 호출만 우선.

---

## 진행 순서

**α → β → γ → δ** 순. 각 페이즈는 독립 검증 가능. β가 가장 invasive — chat.rs 큰 변경 + 도구 결과 저장 스키마 변경.

### 의존성
```
α (1, 2)         독립 — 어디서든 시작 가능
β (3~7)          독립이지만 (5,6)의 신규 도구는 (3) agent loop 전제
γ (8, 9)         (8)은 독립. (9)는 (8)과 시너지지만 분리 가능
δ (10~13)        β의 (3) agent loop 안정 후 진행 권장 (도구 결과 fed back 동작해야 함)
```

### 페이즈별 done 정의
- **α 완료**: 사용자 이름 호명되고, 하루 첫 실행에서 인사+브리핑 voice cycle 동작.
- **β 완료**: "오늘 할 일 뭐야?" 멀티스텝 자연 응답 + create/complete/delete 모두 confirm 후 LLM 자연어 마무리.
- **γ 완료**: 응답 후 followup 발화 가능, 침묵으로 자연 종료. 마이크 임계값 사용자 조정 가능.
- **δ 완료**: 명시적 `remember_fact`로 저장, 다른 세션에서 `search_memory`로 회상.

---

## 참고 — 영향 받는 파일 (예상)

### Phase α
- `core/src/commands/chat.rs` (system prompt)
- `core/src/commands/settings.rs` 또는 직접 settings 테이블 read
- `apps/renderer/src/lib/voice/controller.ts` (speakSequence 추가)
- `apps/renderer/src/AvatarApp.tsx` (bootstrap 분기)
- `apps/renderer/src/stores/useBriefingStore.ts` (consumeAutoPlay 위치)

### Phase β
- `core/src/commands/chat.rs` (agent loop)
- `core/src/services/llm/tools.rs` (신규 도구 추가)
- `core/src/commands/calendar.rs` 또는 신규 (list/delete event용 RPC 진입점이 chat에서 직접 호출 가능해야)
- `core/migrations/0003_*.sql` (필요 시)
- `apps/renderer/src/components/chat/ToolCallConfirmCard.tsx` (일반화)
- `apps/renderer/src/stores/useChatStore.ts` (tool result fed back UX)

### Phase γ
- `apps/renderer/src/lib/voice/controller.ts`
- `apps/renderer/src/components/voice/MicSettingsPanel.tsx`
- `apps/renderer/src/lib/recorder.ts` (settings에서 파라미터 읽기)
- `apps/renderer/src/stores/useUserSettingsStore.ts` (mic.* 키 추가)

### Phase δ
- `core/migrations/0003_*.sql` (memories 테이블)
- `core/src/services/memory.rs` 신규
- `core/src/commands/memory.rs` 신규 또는 chat.rs 확장
- `core/src/services/llm/tools.rs` (search_memory, remember_fact)
