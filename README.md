# Personal Assistant

데스크톱 위젯형 개인 AI 비서. 일정/할 일 자동 브리핑, 자연어 일정 등록, 채팅, 정적 아바타.

## 스택

- **Renderer**: React + TypeScript + Vite + Tailwind
- **Main (Electron)**: Node + Electron — 창/트레이/IPC/단축키
- **Core (Rust 사이드카)**: tokio + sqlx + reqwest + oauth2 + keyring — DB / 외부 API / 비밀 보관
- **외부**: OpenAI (GPT-4o-mini, Whisper, TTS), Google Calendar API
- **저장**: SQLite (DB), OS 키체인 (비밀)

3-tier 분리. Renderer ↔ Main은 contextBridge, Main ↔ Core는 stdio JSON-RPC 2.0 (NDJSON).

상세 문서: [docs/STATUS.md](./docs/STATUS.md) (현재 상태) · [docs/ROADMAP.md](./docs/ROADMAP.md) (향후 계획) · [docs/DECISIONS.md](./docs/DECISIONS.md) (의사결정 기록) · [docs/SETUP.md](./docs/SETUP.md) (개발 환경 재현)

> **연혁**: 초기 버전은 Tauri v2로 시작했으나, 아바타/에이전트 확장성과 상용 배포 운영성을 기준으로 Electron + Rust 코어 사이드카 구조로 전환됨. 사용자 데이터(SQLite) 및 OS 키체인 항목은 동일 경로/SERVICE를 사용해 자동 호환.

---

## 사전 준비

### Windows
1. Rust toolchain — https://rustup.rs/ (stable, MSVC)
2. Visual Studio Build Tools — "C++로 데스크톱 개발" 워크로드
3. Node.js — [nvm-windows](https://github.com/coreybutler/nvm-windows) 추천 (저장소의 `.nvmrc`가 버전 고정). `nvm install $(cat .nvmrc) && nvm use $(cat .nvmrc)`

### macOS
1. Xcode CLT: `xcode-select --install`
2. Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
3. Node.js — [nvm](https://github.com/nvm-sh/nvm) 추천 (`.nvmrc`로 버전 고정). 저장소 루트에서 `nvm use` 한 방

### 확인
```bash
rustc --version
cargo --version
node --version
```

---

## 의존성 설치 / 실행

```bash
npm install
```

### dev (Electron + Rust core)
```bash
npm run dev:main
```

`build:core`(`cargo build --release`)가 자동 선행. Renderer Vite 개발 서버는 `npm run dev:renderer`로 별도 실행해두면 됨 (`apps/main`이 `http://localhost:1420`을 로드).

### 타입 체크
```bash
npm run typecheck
```

### 빌드
```bash
npm run build
```
- `core/target/release/pa-core(.exe)` — Rust 사이드카 바이너리
- `apps/renderer/dist/` — Renderer 정적 산출물
- `apps/main/dist/` — Main 컴파일 산출물

배포용 installer 패키징(electron-builder)과 자동 업데이트(electron-updater + GitHub Releases)는 1.x로 보류. 현재는 `npm run build`로 만든 산출물을 수동 실행하는 형태.

---

## 디렉토리 구조

```
personal_assistant/
├─ apps/
│  ├─ renderer/                       # React UI
│  │  ├─ src/{components,stores,lib,styles}
│  │  ├─ src/AvatarApp.tsx            # avatarWindow 전용 React tree
│  │  ├─ src/PanelApp.tsx             # panelWindow 전용 React tree
│  │  ├─ src/main.tsx                 # ?w=avatar|panel 라우팅
│  │  ├─ src/lib/api.ts               # window.api.* 래퍼 (paApi)
│  │  └─ src/lib/runtime.ts           # api re-export
│  └─ main/                           # Electron Main
│     ├─ src/index.ts                 # 윈도우(2개) / 트레이 / IPC / 라이프사이클
│     ├─ src/preload.ts               # contextBridge로 window.api 노출
│     ├─ src/core/supervisor.ts       # Rust 코어 spawn + JSON-RPC 매칭
│     └─ resources/                   # tray icon
├─ core/                              # Rust 사이드카 (pa-core)
│  ├─ migrations/                     # sqlx::migrate!
│  └─ src/
│     ├─ main.rs                      # stdio JSON-RPC 디스패치 + 30분 polling
│     ├─ rpc/                         # NDJSON / JSON-RPC 2.0
│     ├─ commands/                    # settings/chat/todos/oauth/calendar/briefing/speech
│     ├─ services/                    # llm / calendar / briefing / speech
│     └─ infra/                       # db / paths / secrets / oauth
├─ packages/
│  └─ ipc-types/                      # zod schema (Renderer/Main/Core 공유)
└─ package.json                       # npm workspaces
```

---

## 데이터 경로

- DB: `%APPDATA%\dev.ohmyhong.personalassistant\pa.sqlite` (Win) / `~/Library/Application Support/dev.ohmyhong.personalassistant/pa.sqlite` (Mac)
- 로그: 같은 디렉토리의 `logs/core.log`
- 비밀: **DB에 저장 안 함**. OS 키체인의 `dev.ohmyhong.personalassistant` 서비스 항목

Electron Main이 `app.setPath('userData', ...)`로 위 경로를 명시적으로 고정 → Tauri 시절 사용자 데이터 그대로 호환.

---

## 보안 정책

- 비밀은 OS 키체인 + Rust 코어 프로세스에서만 사용. JS는 raw 값 재조회 불가 (`secret.status`는 마스킹 미리보기만)
- contextIsolation: true / nodeIntegration: false / sandbox: true 시도
- Renderer는 OpenAI / Google 도메인을 직접 호출하지 않음. 모든 외부 API 호출은 Rust 코어에서
- OAuth는 Core가 PKCE+loopback으로 처리, 동의 화면 URL만 Main에 emit → Main은 allowlist (`accounts.google.com` / `oauth2.googleapis.com`) 검증 후 `shell.openExternal`
- 로그에서 `sk-*` 패턴 마스킹

---

## 아바타 이미지

`apps/renderer/public/avatar/`에 PNG 4종을 두면 자동 표시 (없으면 fallback 그라디언트):
- `idle.png` / `listening.png` / `thinking.png` / `speaking.png`

권장: 256×256 PNG, 투명 배경.

---

## 위젯 동작

- **두 개의 BrowserWindow**: `avatarWindow`(144×144) + `panelWindow`(360×416). 둘 다 frameless transparent, alwaysOnTop
- 아바타 클릭 → 패널 표시 (처음엔 아바타 위로, 이후엔 마지막 위치 기억). 다시 클릭 → 패널 숨김
- 패널 표시/숨김은 `show()/hide()` + opacity 페이드(30ms)로 투명 윈도우 플리커 방지
- 아바타와 패널은 **독립적으로 드래그 이동**. 아바타 위치는 종료 후 복원됨, 패널은 메모리만
- **투명 영역 click-through**: 위젯의 투명 영역에 마우스가 있으면 클릭이 데스크톱 앱으로 통과
- **시스템 트레이**: 아바타 보이기/숨기기 / 패널 열기 / 설정 / 종료. 트레이 좌클릭 = 아바타 토글
- **Alt+F4 / X 버튼**은 종료가 아닌 hide. 종료는 트레이 메뉴 또는 시스템 강제 종료

---

## 음성 기능

### 음성 사이클
호칭 감지 또는 단축키(`Ctrl+Shift+Space`) → **인사** → **듣기**(VAD 자동 종료) → **STT**(Whisper) → **채팅**(GPT) → **TTS 응답** → idle

### Wake Word (호칭 인식)
- **TensorFlow.js** `@tensorflow-models/speech-commands` 기반 transfer learning
- 설정 → 음성 탭에서 호��� 샘플 8개 + 배경음 6개를 녹음해 학습
- 학습된 모델은 **IndexedDB에만 저장** (외부 전송 없음)
- 설정 ��� API 탭에서 **항시 마이크 청취** 토글 ON → 백그라운드에서 호칭을 상시 감지
- 단축키 `Ctrl+Shift+Space`는 토글과 무관하게 항상 동작

---

## 마일스톤

### Tauri 1.0 범위 (완료)
- [x] M0 — 부트스트랩 (무프레임 위젯 + DB + 키체인 + Settings)
- [x] M1 — MVP (채팅 + 4상태 아바타 + tool calling todo CRUD + 비용 미터)
- [x] M2 — Google OAuth (PKCE) + Calendar 동기화 + 자연어 일정 등록 + 자동 브리핑
- [x] M3 — TTS + STT (Whisper / tts-1)

### Electron 마이그레이션 (완료)
- [x] EM0 — npm workspaces / `apps/main` 부트스트랩 / `BrowserWindow`
- [x] EM1 — Core 사이드카 + stdio JSON-RPC + `app.health`
- [x] EM2 — Settings / Secrets / Daily cap
- [x] EM3 — Chat / Todos / Cost
- [x] EM4 — OAuth / Calendar / Briefing + 30분 polling + `shell.openExternal` allowlist
- [x] EM5 — Speech (STT/TTS) + macOS 마이크 권한 가드
- [x] EM6 — Window 분리형 (avatarWindow + panelWindow 독립 드래그) + click-through

### EM7 폴리시
- [x] 시스템 트레이 (Show / Hide / Settings / Quit)
- [ ] 글로벌 단축키 (보류)
- [x] 시스템 시작 시 자동 실행 (`app.setLoginItemSettings`)
- [x] 아바타 위치 디스크 저장/복원
- [x] 첫 실행 onboarding
- [ ] 자동 업데이트 + 코드사이닝 (1.x로 보류)
- [x] `src-tauri/` 제거 + `@tauri-apps/*` 의존 제거

### 음성 (Avatar Phase)
- [x] Phase A — 4상태 아바타 이미지 + 표정 전환
- [x] Phase B — 음성 사이클 프로토타입 (단축키 트리거 → 인사 → STT → Chat → TTS)
- [x] Phase C-0 — Wake word 학습 UI (WakeWordTrainer)
- [x] Phase C-1 — Wake word 학습 + 검증 + IndexedDB 저장
- [x] Phase C-2 — Wake word 상시 리스닝 + AvatarApp 연결 + 패널 show/hide 개선
