# Status — 2026-05-03

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
| Wake word active listening (Phase C-2) | ⏳ 다음 |
| 자동 업데이트 / 코드사이닝 | ⏸️ 1.x 보류 |
| 글로벌 단축키 별도 기능 | ⏸️ 보류 (현재 Ctrl+Shift+Space는 voice wake 트리거 전용) |

---

## 동작 가능한 시나리오 (2026-05-03 기준)

### 1. 데스크톱 위젯
- 144×144 아바타 윈도우가 항상 화면에 떠 있음 (alwaysOnTop)
- 드래그로 이동, 위치는 종료 후 자동 복원
- 클릭 시 360×416 패널 윈도우가 별도로 등장 (처음엔 아바타 위, 이후 마지막 위치 기억)
- 패널은 헤더 빈 영역으로 별도 드래그 이동 가능
- 투명 영역 클릭은 데스크톱으로 통과 (`setIgnoreMouseEvents` + hover 추적)

### 2. 채팅
- 패널 채팅 탭에서 텍스트 입력 → GPT-4o-mini 응답
- 마이크 버튼 → VAD 자동 종료 → Whisper STT → 채팅
- 도구 호출 (할 일 추가, 캘린더 일정 등록) tool calling
- 비용 누적 ledger

### 3. Google Calendar
- OAuth (PKCE + loopback) 연결
- 30분 자동 동기화
- 자연어 일정 등록 (도구 호출)
- 오늘/다가오는 일정 조회

### 4. 자동 브리핑
- 그날 첫 실행 시 GPT가 일정/할 일을 짧게 요약
- TTS 재생 (선택 가능, 캐시 대상)

### 5. 음성 사이클 (Phase B prototype)
**트리거**: `Ctrl+Shift+Space` (어디서든)
- attentive: "네, ○○님" 인사 TTS (메모리 캐시, 첫 1회만 생성)
- listening: 자동으로 마이크 켜짐 (1.5초 침묵 시 자동 종료)
- thinking: STT → chat.send (응답 대기)
- speaking: 응답 TTS 발화
- idle 복귀

채팅창에도 사용자/응답 풍선이 자동 추가됨 (Main이 두 윈도우 간 broadcast 중계).

### 6. Wake word 모델 (Phase C-0/C-1, 학습 단계까지)
**위치**: 패널 → 설정 → 음성 탭 → "호칭 학습"
- 베이스: Google Speech Commands 18w (`@tensorflow-models/speech-commands` BROWSER_FFT)
- 라벨 3종: `wake` (호칭), `_background_noise_`, `_unknown_`
- 학습: epochs=30, batch=16, val_split=0.15
- 저장: `indexeddb://personal-assistant-wake`
- 검증: 마이크 켜고 실시간 점수 막대 확인
- Active listening은 아직 미연결 (Phase C-2 작업).

### 7. 시스템 트레이
- Show / Hide / 패널 열기 / 설정 / 종료
- Alt+F4·X 버튼은 hide 처리, 종료는 트레이 메뉴 전용

---

## 아키텍처

```
┌────────────────────────────────────────────────────────────────────┐
│                  Electron Main 프로세스 (Node)                      │
│  • avatarWindow / panelWindow 두 BrowserWindow 관리                  │
│  • IPC 라우팅 (Renderer ↔ Core)                                       │
│  • 트레이, 글로벌 단축키, 자동시작, 윈도우 위치 영속화                 │
│  • 윈도우 간 이벤트 broadcast (panel.openChanged,                     │
│    avatar.stateChanged, chat.turnAdded, voice.wake)                  │
│  • Cursor-polling drag (윈도우별 독립 세션)                           │
└────────────┬─────────────────────────────────────┬─────────────────┘
             │ contextBridge (preload)              │ stdio NDJSON
             │                                       │ (JSON-RPC 2.0)
┌────────────▼──────────────┐              ┌────────▼────────────────┐
│  Renderer (Vite)          │              │  Core (Rust 사이드카)   │
│                           │              │  pa-core(.exe)           │
│  AvatarApp ←→ PanelApp    │              │  • sqlx + keyring +      │
│  (?w=avatar / ?w=panel)   │              │    reqwest + oauth2      │
│                           │              │  • llm/calendar/         │
│  Avatar / BottomPanel /   │              │    briefing/speech       │
│  WakeWordTrainer / ...    │              │  • 30분 polling task     │
│  zustand stores           │              │  • shell.openExternal    │
│                           │              │    이벤트 → Main 위임     │
│  TF.js (lazy import)      │              │                          │
└───────────────────────────┘              └──────────────────────────┘
```

### 윈도우 간 상태 동기화

같은 zustand store 정의를 두 React tree가 각자 인스턴스화한다. 동기화가 필요한 상태는 Main을 통한 broadcast로 처리:

| 상태 | 트리거 | 동기화 경로 |
|---|---|---|
| `panelOpen` | 아바타 클릭 / 헤더 ▾ | `windowSetPanelOpen` IPC → `panel.openChanged` 이벤트 → 양쪽 store |
| `avatarState` | ChatPanel/MicButton/BriefingCard/VoiceController | `setAvatarState` 액션이 `windowSetAvatarState` IPC도 함께 호출 → `avatar.stateChanged` → 양쪽 store |
| `chat.bubbles` | AvatarApp의 voice cycle이 `chatSend` 호출 | Main의 `chatSend` 핸들러가 sender 외 윈도우에 `chat.turnAdded` 이벤트 → PanelApp `appendExternalTurn` |
| voice wake 트리거 | `Ctrl+Shift+Space` | `globalShortcut` → `voice.wake` 이벤트 broadcast → AvatarApp의 VoiceController.wake() |

`useUserSettingsStore` 등 단순 설정 값은 양쪽 윈도우가 자체적으로 `load()` 호출. 한쪽에서 변경한 값은 (현재) 다른 쪽에 자동 반영되지 않는다 — Phase C-2에서 wake 토글 동기화가 필요해지면 같은 broadcast 패턴 적용 예정.

---

## 알려진 한계

| 항목 | 메모 |
|---|---|
| 자동 업데이트 / installer 패키징 | 미구현. 1.x로 보류 (코드사이닝 결정 동반 필요) |
| Linux 자동시작 | `setLoginItemSettings`가 Linux에선 no-op |
| Wake word 화자 검증 | 다른 사람이 호칭 말해도 트리거됨 (Phase D 후보) |
| 글로벌 단축키 (위젯 토글용) | 별도로 구현 안 됨 — 현재 단축키는 voice wake 전용 |
| 사용자 데이터 마이그레이션/백업 도구 | UI 없음. SQLite 파일 직접 복사로 가능 |
| 베이스 모델 (speech-commands 가중치) 오프라인 | 첫 1회 Google CDN 호출 — 패키징 시 동봉 검토 필요 |
| 윈도우 간 settings 변경 자동 반영 | 한쪽에서 토글하면 다른 쪽은 반영 안 됨 (재시작/재로드 필요) |

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
