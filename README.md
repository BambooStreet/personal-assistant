# Personal Assistant

데스크톱 위젯형 개인 AI 비서. 일정/할 일 자동 브리핑, 자연어 일정 등록, 채팅, 정적 아바타.

## 스택

- **Renderer**: React + TypeScript + Vite + Tailwind
- **Main (Electron)**: Node + Electron — 창/트레이/IPC/단축키
- **Core (Rust 사이드카)**: tokio + sqlx + reqwest + oauth2 + keyring — DB / 외부 API / 비밀 보관
- **외부**: OpenAI (GPT-4o-mini, Whisper, TTS), Google Calendar API
- **저장**: SQLite (DB), OS 키체인 (비밀)

3-tier 분리. Renderer ↔ Main은 contextBridge, Main ↔ Core는 stdio JSON-RPC 2.0 (NDJSON).

> **마이그레이션 메모**: 원래 Tauri v2로 시작(`src-tauri/`). 이후 아바타/에이전트 확장성과 상용 배포 운영성 기준으로 Electron + Rust 코어 사이드카 구조로 전환. 사용자 데이터(SQLite) 및 OS 키체인 항목 호환 유지.

---

## 사전 준비

### Windows
1. Rust toolchain — https://rustup.rs/ (stable, MSVC)
2. Visual Studio Build Tools — "C++로 데스크톱 개발" 워크로드
3. Node.js 20+ (LTS)

### macOS
1. Xcode CLT: `xcode-select --install`
2. Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
3. Node.js 20+

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

### dev (Tauri 회귀 비교용 — 1.0 출시 이후 제거 예정)
```bash
npm run dev:tauri
```

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

배포 패키징(electron-builder 등)은 추후 EM7에서 추가 예정.

---

## 디렉토리 구조

```
personal_assistant/
├─ apps/
│  ├─ renderer/                       # React UI
│  │  ├─ src/{components,stores,lib,styles}
│  │  ├─ src/lib/api.ts               # window.api.* 래퍼 (Electron)
│  │  ├─ src/lib/tauri.ts             # Tauri 폴백 (회귀 비교용)
│  │  └─ src/lib/runtime.ts           # 런타임 자동 분기
│  └─ main/                           # Electron Main
│     ├─ src/index.ts                 # 윈도우/IPC/라이프사이클
│     ├─ src/preload.ts               # contextBridge로 window.api 노출
│     └─ src/core/supervisor.ts       # Rust 코어 spawn + JSON-RPC 매칭
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
├─ src-tauri/                         # 구 Tauri 코드 (회귀 비교용, EM7에서 제거)
└─ package.json                       # npm workspaces
```

---

## 데이터 경로 (legacy Tauri와 호환)

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

## 위젯 동작 (1.0)

- 창 크기: 닫힘 144×144(아바타만) / 열림 360×488(패널 + 아바타 lower half)
- 아바타는 항상 창 좌하단 고정. 패널은 항상 위로 펼쳐지며 아바타 상반부와 살짝 겹침
- 아바타 클릭 → 패널 토글 (`setBounds`로 원자 리사이즈, 좌하단 anchor 유지)
- 아바타 드래그 → 창 이동 (Main이 cursor 폴링으로 추적)
- 패널 헤더의 ▾ 버튼으로도 닫기 가능

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
- [x] EM6 — Window 통합 (간소화: 144⇄488 토글, 좌하단 anchor, 4분면 자동 회전 제거)

### 남은 작업
- [ ] EM7 — 트레이 / 글로벌 단축키 / 자동시작 / 자동업데이트(electron-builder + GitHub Releases) / 단일 인스턴스 락 / 첫 실행 onboarding / `src-tauri` 완전 제거
