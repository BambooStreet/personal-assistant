# Conversation Rework — 작업 로그

기록일: 2026-05-06.
계획서: [CONVERSATION-PLAN.md](./CONVERSATION-PLAN.md).
목표: **대화감 살리기** — 자연스러운 음성/채팅 경험.

원래 계획대로 4페이즈 (α → β → γ → δ) 모두 완료 + 음성 UX 폴리시 + 캐릭터(고양이) 입히기 + TTS 업그레이드.

---

## Phase α — 사용자 이름 + 첫 실행 voice cycle

**문제**: 시스템 프롬프트에 사용자 이름이 없어서 호명 못 함. 하루 첫 실행 인사가 wake에서만 동작 (자동 X).

**변경**:
- `core/src/commands/chat.rs` — `read_user_name()` 헬퍼로 settings의 `user.name` 조회. `build_system_prompt`이 이름을 받아 "사용자 이름: ○○님 (호명할 때 사용)" 라인 삽입
- `apps/renderer/src/lib/voice/controller.ts` — `speakSequence({greetingAudio, briefingAudio})` 추가. listening/thinking 스킵하고 attentive→speaking 두 번 TTS만 실행
- `apps/renderer/src/AvatarApp.tsx` — `bootstrapBriefing()`이 `created=true` 반환 + `autoPlayBriefing` 활성화면 greeting + briefing TTS 병렬 페치 후 `speakSequence` 호출. `useBriefingStore.consumeAutoPlay()`로 BriefingCard 중복 자동재생 방지

**검증**: chat에 "내 이름 알아?" → 호명 정확. 오늘자 briefing 삭제 후 재시작 → 패널 자동 오픈 + 인사+브리핑 TTS 두 번.

---

## Phase β — Chat agent loop

**문제**: LLM이 도구 호출 후 결과를 history에 못 봄. 멀티스텝("오늘 할 일 뭐야?" → "운동 다 했어")이 작동 X. 캘린더 조회/삭제 도구도 없음.

**변경**:
- `core/migrations/0003_messages_tool_calls.sql` — `messages` 테이블에 `tool_calls_json TEXT` 컬럼 추가
- `core/src/services/llm/tools.rs` — 신규 도구 5개:
  - `delete_todo`, `delete_event`, `list_today_events`, `list_upcoming_events`
  - `list_today_overview` — 할 일 + 오늘 일정 통합 (events는 summary+start_at만 압축)
- `core/src/services/llm/dispatch.rs` (신규) — read-only 도구 자동 실행, write는 UI confirm 경로
  - `is_read_only(name)`, `execute_tool(state, name, args)`
- `core/src/commands/chat.rs` — `chat_send`/`chat_continue` agent loop. `MAX_AGENT_ITERATIONS=4`. tool 메시지 fed back → LLM 재호출 반복. 멀티 tool_calls는 첫 번째만 처리 (history 일관성). orphan tool_call 자동 정리 (`close_orphan_tool_calls`)
- 시스템 프롬프트 강화: "할 일/todo는 list_todos 계열, 일정/미팅은 list_today_events 계열" 구분 + list_today_overview 우선 사용 가이드 + "오늘 할 일" 응답 포맷 (섹션 분리)
- IPC 추가: `Methods.ChatContinue`, main의 `chat.continue` 핸들러 (chatSend처럼 다른 윈도우에 fan-out)
- `apps/renderer/src/components/chat/ToolCallConfirmCard.tsx` — switch 일반화: `complete_todo`/`delete_todo`/`delete_event` 카드 추가. 모든 카드가 confirm/reject 후 `chatContinue` 호출
- `apps/renderer/src/stores/useChatStore.ts` — `confirmTool(call, executor)` + `rejectTool(call)` actions. tool-call-only assistant 메시지(text 없음) UI에서 숨김 — confirm 카드가 곧 UI

**검증**: "오늘 할 일 보여줘" → list_todos 자동 → 자연어 응답. "운동 끝" → list_todos → complete_todo confirm 카드 → 확정 → "잘했어요" 응답.

---

## Phase γ — 연속 대화 + 마이크 튜닝

**문제**: 응답 후 idle 종료 → 후속 발화 불가. VAD 노이즈 적응 없음. wake 민감도 너무 높음. Whisper 환각.

**변경**:
- `core/src/commands/settings.rs` — ALLOWED_SETTING_KEYS에 6개 추가: `mic.threshold_rms`, `mic.silence_ms`, `mic.initial_wait_ms`, `mic.followup_initial_wait_ms`, `mic.followup_max_duration_ms`, `voice.followup_enabled`, `wake.threshold`, `wake.display_label`
- `apps/renderer/src/stores/useUserSettingsStore.ts` — VAD/voice/wake 신규 필드 + setters + `resetMicVadToDefaults`
- `apps/renderer/src/lib/voice/controller.ts`:
  - `followup-listening` 단계 추가. wake() 루프가 `runConversationTurn(isFollowup)` 반복. pending tool / 침묵 / 종료 의도 시 break
  - `VadParams` opts (initial vs followup 분리). speaking 끝나면 followup으로 짧은 wait 재진입
- `apps/renderer/src/lib/recorder.ts` — VAD 침묵 감지 강화:
  - 슬라이딩 1초 윈도우 RMS 최솟값을 noise floor로 추적 (발화 중에도 음절 사이로 적응)
  - effective threshold = max(설정값, floor × 3.0). 시끄러운 환경에서 자동 임계값 상승
  - VOICE_ONSET_FRAMES 6 → 10 (≈170ms 지속 voice 필요)
  - 1초마다 `[vad] rms=... floor=... eff=...` 디버그 로그
- Wake word 민감도 설정화 (`wake.threshold`, 기본 **0.98**). 슬라이더 값 변경 시 listen 자동 stop→start로 즉시 반영
- Wake listener를 voice cycle 동안 일시 정지 (`onCycleStart`/`onCycleEnd` 콜백). TTS 자기 음성에 wake 트리거되는 문제 해결
- 짧은 발화(speechMs < 800) STT 스킵 — Whisper hallucination 방지
- Whisper 환각 phrase 필터: "시청해 주셔서 감사합니다", "구독과 좋아요", "Thanks for watching" 등 정확 매칭
- `apps/renderer/src/components/voice/MicSettingsPanel.tsx` — `VadTuningSection`: 4 슬라이더(임계값/침묵/첫발화/후속발화) + 후속 토글 + Wake 슬라이더 + Wake 라벨 텍스트 입력 + 기본값 복원

**검증**: 응답 후 followup-listening 자동 진입. 후속 질문 받음. 침묵 4초 → idle. 시끄러운 환경 콘솔에서 floor 자동 상승 확인.

---

## Phase δ — 메모리 시스템

**문제**: 사용자 선호/배경을 LLM이 기억 못 함. 장기 메모리 없음.

**변경**:
- `core/migrations/0004_memories.sql` — `memories` 테이블 (id, content, tags JSON, source_conversation, created_at, last_used_at)
- `core/src/services/memory.rs` (신규):
  - `insert(content, tags, source_conv)` → `Memory`
  - `search(query, limit)` — content + tags LIKE 검색, 매치된 row의 last_used_at 갱신 (LRU)
- `core/src/commands/memory.rs` (신규) — IPC wrapper
- `core/src/services/llm/tools.rs`:
  - `remember_fact(content, tags?)` — write tool, UI confirm
  - `search_memory(query, limit?)` — read-only, 자동 실행
- 시스템 프롬프트: "안정적 사실은 자연스럽게 활용. 모르면 search_memory, 새로 알게 된 재사용 가치 있는 사실은 remember_fact로 저장. 일회성 정보 X"
- IPC: `Methods.MemoryRemember`, `Methods.MemorySearch` + 핸들러
- `RememberFactCard` UI confirm

**검증**: "나 커피 안 마셔, 차 좋아해" → remember_fact confirm → DB row 생김. 다른 세션 "오후 카페 갈까?" → search_memory("커피 차 음료") 자동 → "차 좋아하시잖아요" 응답.

---

## 채팅 로그 일관성 정리

**문제**:
1. tool-call-only assistant 메시지가 "(remember_fact 제안)" 같은 placeholder로 채팅에 노이즈
2. 음성 cycle 발화가 panel에 동기화되긴 하지만 일관성 깨짐 (live = `(name 제안)`, loadHistory = 텍스트만)
3. 도구 confirm 후 LLM 마무리 응답이 voice TTS 안 됨

**변경**:
- `appendExternalTurn`/`send`/`finalizeTurn`이 `assistant_text` 비면 placeholder 안 만듦
- `ChatBubble.source: 'voice' | 'text'` 추적, `lastUserSource` store-level
- `ChatBubble.uiOnly` 마커 — DB persist 안 된 세션 한정 표시는 `loadHistory`가 보존 (timestamp 머지)
- confirmTool/rejectTool: 직전 user의 source가 voice면 chatContinue 응답을 `playVoiceResponse`로 자동 TTS + 아바타 speaking 애니메이션
- `chat.continue`도 broadcast (`chat.turnContinued`) — 다른 윈도우 동기화
- Wake 호출 + 인사를 채팅 로그에 표시 (`appendWakeCall`, `uiOnly`로 DB 미저장)

---

## 음성 UX 폴리시

**Wake 라벨 커스텀**:
- `wake.display_label` setting. 채팅 로그의 "(부름)" 자리에 사용자 학습 단어 ("보조야" 등) 표시
- MicSettingsPanel에 텍스트 입력란

**종료 의도 인식**:
- `controller.ts::isTerminationIntent()` — "그만/됐어/고마워/감사/끝/잘자/안녕/바이" 정확 매칭
- 매칭 시 LLM 호출 없이 followup 즉시 종료. 보수적 (예: "그만 해줘" 같은 자연 요청은 통과)

**Voice confirm**:
- `apps/renderer/src/lib/chat/toolExecutors.ts` (신규) — `executeTool(call)` 중앙 dispatch (UI/voice 공유)
- `useChatStore`: `confirmPendingByVoice(id)` / `rejectPendingByVoice(id)` — broadcast 받으면 pendingTool 매칭해 자동 실행
- `VoiceController`: chatSend가 pending tool 반환하면 응답 텍스트 비면 "이대로 진행할까요?" 추가 TTS, 짧은 응답 캡처 후 `classifyYesNo` (예/네/응/그래/추가/저장 → confirm, 아니/취소/싫어 → reject). 결정 시 `voice.toolConfirmRequested`/`voice.toolRejectRequested` broadcast. 모호하면 UI confirm 카드로 fallback

---

## 캐릭터 입히기 (고양이) + TTS 업그레이드

**캐릭터**:
- `apps/renderer/public/avatar/` 폴더 + 5장 고양이 PNG (idle/attentive/listening/thinking/speaking)
- `Avatar.tsx`에서 원형 마스크 + 그라디언트 배경 + outline 제거. `object-cover` → `object-contain`. ring/wave 상태 효과는 유지
- 아바타 size 120 → 140. 윈도우 144 → 200 (wave 1.35x = 189px fit). 컨테이너 `h-40 w-40` → `h-[200px] w-[200px]`. 패널 위치 자동 재정렬

**TTS 업그레이드**:
- 모델 `tts-1` → **`gpt-4o-mini-tts`** (`core/src/services/speech/tts.rs`)
- `instructions` 파라미터로 캐릭터 톤 지시: "친근하고 발랄한 톤... 작은 고양이 비서가 말하듯 따뜻하고 귀엽게..."
- 신규 voice 5개 추가: `ash`, `ballad`, `coral`, `sage`, `verse`. 기본 `coral`로 (귀엽고 따뜻)
- 가격 $15→$12 per 1M chars (오히려 저렴)
- `VoiceSettingsPanel`에 라벨/힌트 갱신

---

## 영향 받은 파일 (요약)

### Core (Rust)
- `core/migrations/0003_messages_tool_calls.sql`, `0004_memories.sql` (신규)
- `core/src/commands/chat.rs` — agent loop, system prompt, orphan cleanup
- `core/src/commands/memory.rs` (신규)
- `core/src/commands/settings.rs` — allowlist 확장
- `core/src/commands/speech.rs` — cost ledger 모델 이름
- `core/src/services/llm/dispatch.rs` (신규)
- `core/src/services/llm/tools.rs` — 7개 신규 도구
- `core/src/services/memory.rs` (신규)
- `core/src/services/speech/tts.rs` — gpt-4o-mini-tts + instructions
- `core/src/services/speech/cost.rs` — $12/1M
- `core/src/main.rs` — 새 RPC 라우트

### Renderer (TS)
- `apps/renderer/public/avatar/` — 5장 고양이 PNG + README
- `apps/renderer/src/AvatarApp.tsx` — bootstrap voice cycle, voice cycle hooks
- `apps/renderer/src/PanelApp.tsx` — chat.turnContinued, chat.wakeCalled, voice.toolConfirm/Reject 리스너
- `apps/renderer/src/components/avatar/Avatar.tsx` — 원형 제거
- `apps/renderer/src/components/chat/ToolCallConfirmCard.tsx` — 일반화 + RememberFactCard
- `apps/renderer/src/components/voice/MicSettingsPanel.tsx` — VAD/wake 슬라이더
- `apps/renderer/src/components/voice/VoiceSettingsPanel.tsx` — 신규 voice
- `apps/renderer/src/components/widget/AvatarShell.tsx` — 사이즈 200
- `apps/renderer/src/lib/api.ts` — chatContinue, memory* 타입
- `apps/renderer/src/lib/chat/toolExecutors.ts` (신규)
- `apps/renderer/src/lib/recorder.ts` — adaptive noise floor, speechMs
- `apps/renderer/src/lib/voice/controller.ts` — followup-listening, voice confirm, hallucination/termination 필터
- `apps/renderer/src/stores/useChatStore.ts` — source 추적, uiOnly, voice TTS, confirmPendingByVoice
- `apps/renderer/src/stores/useUserSettingsStore.ts` — VAD/wake/followup 키 + 신규 voice 목록

### Main / IPC
- `apps/main/src/ipc.ts` — chat.send/continue fan-out, memory* forward
- `apps/main/src/preload.ts` — chatContinue, memoryRemember/Search
- `apps/main/src/windows.ts` — AVATAR_W/H 200
- `packages/ipc-types/src/methods.ts` — ChatContinue, MemoryRemember, MemorySearch

---

## 미해결 / 후속

- **Auto-extract 메모리**: 대화 끝에 "기억할 만한 사실" 자동 추출 (비용/복잡도 trade-off)
- **다중 tool_calls 병렬 처리**: 현재 첫 번째만 실행, 나머지 drop
- **Briefing TTS 캐시**: greeting처럼 메모리 캐시
- **메모리 관리 UI**: settings에서 저장된 메모리 목록/편집/삭제
- **페르소나 텍스트**: system prompt에 어조 커스텀 라인
- **PNG 압축 폴리시**: 현재 ~800KB/장 → tinypng로 ~200KB로
