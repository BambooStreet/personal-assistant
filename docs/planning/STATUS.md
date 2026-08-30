# Status — 2026-05-06

이 문서는 현재까지의 진행 상황을 요약한다. 큰 그림은 README, 향후 계획은 [ROADMAP.md](./ROADMAP.md), 의사결정 기록은 [DECISIONS.md](./DECISIONS.md).

---

## 한눈에

| 항목 | 상태 |
|---|---|
| 기능 마일스톤 (M0~M3) | ✅ 모두 동작 |
| Tauri → Electron 마이그레이션 (EM0~EM7) | ✅ 완료 (자동업데이트 보류) |
| 두 윈도우 분리형 위젯 | ✅ avatarWindow + panelWindow 독립 |
| 시스템 트레이 / 자동시작 / 위치 복원 / 첫실행 onboarding | ✅ |
| 아바타 시각 폴리시 (Phase A) | ✅ |
| 음성 사이클 prototype (Phase B) | ✅ 단축키 트리거 동작 |
| Wake word 모델 학습 UI (Phase C-0/C-1) | ✅ 학습 + 검증까지 |
| Wake word active listening (Phase C-2) | ✅ 음성 토글 시 자동 listen |
| 코드 정리 패스 (W1~S2) | ✅ Methods 단일 출처화 + main 분해 + dead code 제거 |
| 대화감 리워크 (Conversation Phase α/β/γ/δ) | ✅ 자세히는 [CONVERSATION-REWORK.md](./CONVERSATION-REWORK.md) |
| 캐릭터(고양이) 입히기 + gpt-4o-mini-tts | ✅ 5상태 PNG + instructions로 캐릭터 톤 |
| Wake word 온라인 개선 루프 (Phase C-3) | ⏳ 다음 |
| 자동 업데이트 / 코드사이닝 | ⏸️ 1.x 보류 |
| 글로벌 단축키 별도 기능 | ⏸️ 보류 (현재 Ctrl+Shift+Space는 voice wake 트리거 전용) |

---

## 동작 가능한 시나리오 (2026-05-03 기준)

### 1. 데스크톱 위젯
- 200×200 아바타 윈도우 (고양이 캐릭터 140px + ring/wave 효과 여유)가 항상 화면에 떠 있음 (alwaysOnTop)
- 드래그로 이동, 위치는 종료 후 자동 복원
- 클릭 시 360×416 패널 윈도우가 별도로 등장 (처음엔 아바타 위, 이후 마지막 위치 기억)
- 패널은 헤더 빈 영역으로 별도 드래그 이동 가능
- 투명 영역 클릭은 데스크톱으로 통과 (`setIgnoreMouseEvents` + hover 추적)

### 2. 채팅 — agent loop
- 패널 채팅 탭에서 텍스트 입력 → GPT-4o-mini 응답
- 마이크 버튼 → VAD 자동 종료 → Whisper STT → 채팅
- 도구 호출: `create_todo`/`complete_todo`/`delete_todo`/`list_todos`/`create_event`/`delete_event`/`list_today_events`/`list_upcoming_events`/`list_today_overview`/`remember_fact`/`search_memory`
- 읽기 도구 자동 실행, 쓰기 도구 UI confirm 또는 voice 음성 confirm
- LLM 응답 텍스트 + 도구 결과 fed back으로 멀티스텝 자연스러움
- 비용 누적 ledger

### 3. Google Calendar
- OAuth (PKCE + loopback) 연결
- 30분 자동 동기화
- 자연어 일정 등록 (도구 호출)
- 오늘/다가오는 일정 조회

### 4. 앱 시작 인사 (D-025)
- **앱을 켤 때마다** 인사. 하루 한 번이 아니다 — 마지막 인사로부터 3시간 쿨다운만 있다.
  트레이에서 창을 여닫는 건 트리거가 아님(프로세스가 살아 있으므로).
- 마지막으로 마주친 뒤 얼마나 지났는지(캘린더 일수)에 따라 톤이 바뀜 — "또 봐요" / "오늘 뭐
  했어요?" / "며칠 만이네요" / "오랜만이에요, 잘 지냈어요?".
- **인사는 인사만 한다.** 할 일·일정을 프롬프트에 아예 싣지 않는다(실으면 LLM이 반드시 짚는다).
- gpt-4o-mini 생성, 키 없음·API 실패 시 폴백 문구 풀에서 **반드시 발화**.
- 채팅 말풍선으로 남고(`messages.source='greeting'`), LLM 컨텍스트엔 최근 1건만 들어간다.

### 4-1. 모닝 브리핑 (오늘의 한마디)
- **아침 창 안에서 앱을 켰을 때만** 생성 — 기본 05:00~13:00, 설정 → 알림 탭에서 조절.
  그 창 밖에서 켠 날은 인사만 하고 브리핑은 없다. 창 안이면 하루 한 번.
- 일정/할 일은 맥락으로만 넘기고 나열·요약은 하지 않음(목록은 채팅 카드와 개인 탭이 이미 보여줌).
  오늘 가장 중요한 것 하나만 짚어 등을 밀어주는 1~2문장. 인사는 하지 않는다(앞에서 이미 했다).
- 표시는 채팅 상단 **브리핑 카드**. 음성은 인사 뒤에 이어서 재생(이번에 새로 만들어졌을 때만).
- 카드 하단에 **오늘 해당하는 목표 루틴 줄**(`goal_lines`) — Core가 결정론적으로 생성(LLM 아님).
  캐시에 저장하지 않고 반환 지점마다 재계산하므로 목표를 방금 추가해도 즉시 반영. TTS는 summary만 읽음.

### 4-2. 목표 + 루틴 알림 (D-021)
- 목표(제목 + '왜' 여러 개) + 루틴(요일 비트마스크 + 시각 한 점, 목표당 여러 개). '개인' 탭 섹션(기본 접힘).
- 정한 시각에 OS 알림. 문구는 gpt-4o-mini가 그날의 '왜'(날짜 기반 로테이션) + 요일 + 일정 밀도로
  매번 새로 생성, 키 없음·API 실패 시 폴백 문구로 **반드시 발화**.
- **DND를 통과**한다(사용자가 직접 정한 시각이므로). 단 `notifications.enabled` 마스터 스위치는 존중.
- 지각 발화 상한 60분 — 22:00 루틴을 22:30에 켜면 뜨고 23:10엔 안 뜸.
- 의도적 미구현: 진척률·스트릭·대시보드·마일스톤·주간 회고·완료 추적·채팅 도구·텔레그램.
- ⚠️ 데스크톱 앱이 켜져 있어야 뜬다(밤 루틴이 이 한계에 가장 많이 걸림).

### 5. 음성 사이클 (Phase B/γ — 연속 대화)
**트리거**: `Ctrl+Shift+Space` 또는 wake word (`wake.threshold=0.98`)
- attentive: "네, ○○님" 인사 TTS (gpt-4o-mini-tts + 캐릭터 instructions)
- listening: 자동 마이크 (adaptive noise floor — 시끄러운 환경 자동 임계값 상승)
- thinking: STT → agent loop
- speaking: 응답 TTS 발화
- **followup-listening**: 응답 후 자동 짧은 wait로 후속 발화 받음 (4초 침묵 시 idle)
- 종료 의도("그만/됐어/고마워/끝") 인식 시 LLM 호출 없이 즉시 idle
- 도구 confirm 음성 처리: "이대로 진행할까요?" → "응/아니" 분류 → 자동 실행

Wake listener는 voice cycle 동안 자동 일시 정지 (TTS 자기음성 트리거 방지). 짧은 캡처 / Whisper 환각 phrase는 STT 스킵.

채팅창에 사용자/응답 풍선 + wake 호출 + 도구 confirm 결과 모두 동기화 (Main이 broadcast 중계).

### 6. Wake word 모델 (Phase C-0/C-1/C-2)
**위치**: 패널 → 설정 → 음성 탭 → "호칭 학습"
- 베이스: Google Speech Commands 18w (`@tensorflow-models/speech-commands` BROWSER_FFT)
- 라벨 3종: `wake` (호칭), `_background_noise_`, `_unknown_`
- 학습: epochs=30, batch=16, val_split=0.15
- 저장: `indexeddb://personal-assistant-wake`
- 검증: 마이크 켜고 실시간 점수 막대 확인
- **Active listening (C-2)**: 패널 → 설정 → 음성 탭의 토글로 ON 시 AvatarApp이 detector를 백그라운드 listen 모드로 진입. 호칭 감지 시 voice cycle (`voiceController.wake()`) 자동 트리거. `voice.enabledChanged` 이벤트로 양쪽 윈도우 동기화.

### 7. 시스템 트레이
- Show / Hide / 패널 열기 / 설정 / 종료
- Alt+F4·X 버튼은 hide 처리, 종료는 트레이 메뉴 전용

### 8. 메모리 시스템 (δ)
- `memories` 테이블 + `remember_fact`/`search_memory` 도구
- 사용자가 "기억해줘" 류 발화 → confirm 카드 → DB persist
- 다른 세션에서 LLM이 `search_memory` 자동 호출 (시스템 프롬프트 가이드)
- LIKE content+tags 검색, LRU(`last_used_at`) 정렬
- auto-extraction은 보류 (명시 호출만)

### 9. 캐릭터 + 음성 톤 (고양이)
- `apps/renderer/public/avatar/` 5상태 PNG (idle/attentive/listening/thinking/speaking)
- 원형 마스크 제거, 고양이 자연스럽게 표시. ring/wave 상태 효과는 유지
- TTS 모델 `gpt-4o-mini-tts` + `instructions`로 "친근하고 발랄한 작은 고양이 비서" 톤 지시
- 신규 voice: `coral`(기본)/`ash`/`ballad`/`sage`/`verse` 추가 + 미리듣기

---

## 아키텍처

```
┌────────────────────────────────────────────────────────────────────┐
│                  Electron Main 프로세스 (Node)                      │
│  apps/main/src/                                                      │
│   ├ index.ts        앱 라이프사이클 (single-instance/whenReady)      │
│   ├ windows.ts      avatar/panel BrowserWindow + 위치 영속화          │
│   ├ ipc.ts          @pa/ipc-types Methods 기반 IPC 등록 + forward     │
│   ├ tray.ts         시스템 트레이 메뉴                                │
│   ├ drag.ts         cursor-polling 드래그 (윈도우별 독립)             │
│   ├ oauth-shell.ts  shell.openExternal allowlist                     │
│   ├ state.ts        공유 가변 싱글톤 (core, isQuitting)               │
│   ├ preload.ts      contextBridge로 window.api 노출                   │
│   └ core/supervisor.ts  pa-core child_process 관리                    │
└────────────┬─────────────────────────────────────┬─────────────────┘
             │ contextBridge (preload)              │ stdio NDJSON
             │ Methods.X로 채널 식별                 │ (JSON-RPC 2.0)
┌────────────▼──────────────┐              ┌────────▼────────────────┐
│  Renderer (Vite)          │              │  Core (Rust 사이드카)   │
│                           │              │  pa-core(.exe)           │
│  AvatarApp ←→ PanelApp    │              │  • sqlx + keyring +      │
│  (?w=avatar / ?w=panel)   │              │    reqwest + oauth2      │
│                           │              │  • llm/calendar/         │
│  Avatar / BottomPanel /   │              │    briefing/speech       │
│  WakeWordTrainer / ...    │              │  • 30분 polling task     │
│  zustand stores           │              │  • shell.openExternal    │
│  lib/api.ts (단일 진입점)  │              │    이벤트 → Main 위임     │
│  TF.js (lazy import)      │              │                          │
└───────────────────────────┘              └──────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  packages/ipc-types/  (단일 출처)                                    │
│   ├ methods.ts      Methods 레지스트리 (IPC 채널 = core RPC 메서드)   │
│   ├ schemas.ts      zod 스키마 + 타입 (런타임 검증은 미적용)          │
│   └ events.ts       Main → Renderer 이벤트 페이로드 타입              │
│  Methods.X 한 const가 preload/main/core 양쪽에서 같은 문자열을 가리킴.│
└────────────────────────────────────────────────────────────────────┘
```

### 윈도우 간 상태 동기화

같은 zustand store 정의를 두 React tree가 각자 인스턴스화한다. 동기화가 필요한 상태는 Main을 통한 broadcast로 처리:

| 상태 | 트리거 | 동기화 경로 |
|---|---|---|
| `panelOpen` | 아바타 클릭 / 헤더 ▾ | `Methods.WindowSetPanelOpen` IPC → `panel.openChanged` 이벤트 → 양쪽 store |
| `avatarState` | ChatPanel/MicButton/BriefingCard/VoiceController | `setAvatarState` 액션이 `Methods.WindowSetAvatarState` IPC도 함께 호출 → `avatar.stateChanged` → 양쪽 store |
| `chat.bubbles` | AvatarApp의 voice cycle이 `chatSend` 호출 | Main의 `Methods.ChatSend` 핸들러가 sender 외 윈도우에 `chat.turnAdded` 이벤트 → PanelApp `appendExternalTurn` |
| voice wake 트리거 | `Ctrl+Shift+Space` 또는 wake word 감지 | `globalShortcut` 또는 detector → `voice.wake` 이벤트 broadcast → AvatarApp의 `VoiceController.wake()` |
| `voiceEnabled` | 패널 → 설정 → 음성 토글 | `setVoiceEnabled` 액션이 `Methods.WindowBroadcast`로 `voice.enabledChanged` emit → AvatarApp이 받아 store 직접 set + wake listening start/stop |

`useUserSettingsStore` 중 voice.enabled는 위 패턴으로 동기화됨. 다른 설정 값(voice/micDevice/userName 등)은 한쪽에서 변경 시 다른 쪽에 자동 반영되지 않으며, 세 번째 인스턴스 등장 시 일반화 (`useSyncedStore` 헬퍼) 검토.

---

## 알려진 한계

| 항목 | 메모 |
|---|---|
| Windows 인스톨러 (NSIS) | ✅ `npm run package:win` → `dist-electron/Personal Assistant Setup 0.1.0.exe` (코드사이닝 없음, SmartScreen 1회 경고) |
| 자동 업데이트 | 미구현. 1.x로 보류 (코드사이닝 결정 동반 필요) |
| Linux 자동시작 | `setLoginItemSettings`가 Linux에선 no-op |
| Wake word 화자 검증 | 다른 사람이 호칭 말해도 트리거됨 (Phase D 후보) |
| 글로벌 단축키 (위젯 토글용) | 별도로 구현 안 됨 — 현재 단축키는 voice wake 전용 |
| 사용자 데이터 마이그레이션/백업 도구 | UI 없음. SQLite 파일 직접 복사로 가능 |
| 베이스 모델 (speech-commands 가중치) 오프라인 | 첫 1회 Google CDN 호출 — 패키징 시 동봉 검토 필요 |
| Wake word 학습 모델 origin 격리 | IndexedDB가 origin-scoped라 dev(`localhost:1420`)와 패키징본(`file://`) 사이 모델이 공유 안 됨. 패키징본에서 1회 재학습 필요. (1.x 폴리시 후보: SQLite blob/파일로 이전) |
| 윈도우 간 settings 자동 반영 | `voice.enabled`만 broadcast로 즉시 반영. 그 외(voice/micDevice/userName)는 재시작/재로드 필요 |
| IPC 런타임 검증 | `@pa/ipc-types`의 zod 스키마는 정의돼 있으나 IPC 경계에서 parse 미적용 (타입만 활용) |
| Rust ↔ TS 메서드명 일관성 | `Methods` 레지스트리는 TS 단일 출처. core(`main.rs`의 `dispatch`)는 별도 문자열 리터럴 — 코드젠 미구현, 사람이 일치 유지 |

---

## 데이터 경로

- DB: `%APPDATA%\dev.ohmyhong.personalassistant\pa.sqlite` (Win) / `~/Library/Application Support/dev.ohmyhong.personalassistant/pa.sqlite` (Mac)
- 로그: 같은 디렉토리의 `logs/core.log`
- 비밀: OS 키체인 `dev.ohmyhong.personalassistant`
- 아바타 윈도우 위치: `userData/avatar-window-state.json`
- Wake word 모델: 브라우저 IndexedDB (origin-scoped)

---

## 보안 정책 요약

- contextIsolation: true / nodeIntegration: false / sandbox: false (preload 내부 require 필요로 임시)
- OAuth 동의 화면 URL은 Core가 emit, Main이 `accounts.google.com` / `oauth2.googleapis.com` allowlist 검증 후 `shell.openExternal`
- 비밀은 OS 키체인 + Rust 코어에서만. JS는 raw 값 재조회 불가 (`secret.status`는 마스킹 미리보기만)
- macOS 마이크 권한은 `systemPreferences.askForMediaAccess` 가드
- Renderer는 외부 도메인 직접 호출 금지 — 모든 OpenAI/Google 호출은 Core
- Wake word 학습 데이터는 100% 로컬 (외부 전송 X)
