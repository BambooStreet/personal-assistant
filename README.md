# Personal Assistant

데스크톱 위젯형 개인 AI 비서. 일정/할 일 브리핑, 자연어 일정 등록, 일상 대화, 정적 아바타.

- 클라이언트: Tauri v2 + React + TypeScript + Vite + Tailwind
- 로컬 DB: SQLite (sqlx, Rust 측 단일 진입점)
- 비밀 저장: OS 키체인 (`keyring-rs`)
- LLM/음성: GPT-4o-mini, OpenAI Whisper, OpenAI TTS
- 외부 연동: Google Calendar API (M2~)

현재 상태: **M0 부트스트랩 완료**. 무프레임 위젯 창 + Settings에서 OpenAI 키 저장 + DB/키체인 골격.

---

## 사전 준비 (Windows)

1. **Rust toolchain** — https://rustup.rs/ 에서 `rustup-init.exe` 실행 (stable, MSVC)
2. **Visual Studio Build Tools** — "C++로 데스크톱 개발" 워크로드 (MSVC, Windows SDK)
   - https://visualstudio.microsoft.com/ko/visual-cpp-build-tools/
3. **Node.js 20+** — https://nodejs.org/ (LTS)
4. **WebView2 Runtime** — Windows 11에는 기본 포함. 누락 시 https://developer.microsoft.com/microsoft-edge/webview2/

확인:

```powershell
rustc --version
cargo --version
node --version
npm --version
```

## 사전 준비 (macOS)

1. **Xcode Command Line Tools**: `xcode-select --install`
2. **Rust toolchain**: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
3. **Node.js 20+** (Homebrew: `brew install node`)

---

## 의존성 설치 및 dev 실행

PowerShell 또는 터미널에서 프로젝트 루트:

```bash
npm install
npm run tauri dev
```

첫 실행은 Rust crate 컴파일로 5~10분 소요. 이후 증분 빌드는 빠름.

빌드:

```bash
npm run tauri build
```

산출물: `src-tauri/target/release/bundle/` (Windows: `.msi`/`.exe`, macOS: `.app`/`.dmg`)

타입 체크만:

```bash
npm run typecheck
```

---

## 데이터 경로

- DB: `%APPDATA%\dev.ohmyhong.personalassistant\pa.sqlite` (Win) / `~/Library/Application Support/dev.ohmyhong.personalassistant/pa.sqlite` (Mac)
- 로그: 같은 디렉토리의 `logs/app.log.YYYY-MM-DD`
- 오디오 캐시 (M3~): 같은 디렉토리의 `audio_cache/`
- 비밀: **DB에 저장 안 함**. OS 키체인의 `dev.ohmyhong.personalassistant` 서비스 항목

---

## 아바타 이미지

`public/avatar/` 에 다음 파일을 넣으면 자동 표시됨 (없으면 fallback 그라디언트):

- `idle.png` — 기본 상태
- `listening.png` — 마이크 입력 중 (M3)
- `thinking.png` — LLM 응답 대기 (M1)
- `speaking.png` — TTS 재생 중 (M3)

권장 크기: 256×256 PNG (투명 배경).

---

## 보안 정책

- 저장된 비밀은 **OS 키체인 + Rust 프로세스에서만** 사용. JS에서 raw 값 재조회 불가 — `secret_status`는 마스킹된 미리보기만 반환
- 사용자가 UI에서 입력한 값은 제출 시점까지 일시적으로 렌더러 메모리에 존재 가능. 제출 직후 입력 필드 클리어
- 모든 외부 API 호출(OpenAI / Google)은 Rust에서만. React는 OpenAI/Google URL을 직접 호출하지 않음
- 로그에서 키/토큰 마스킹

---

## 디렉토리 구조

```
personal_assistant/
├─ src/                              # React frontend
│  ├─ App.tsx, main.tsx
│  ├─ components/{avatar,chat,settings,widget}/
│  ├─ stores/                        # Zustand
│  ├─ lib/                           # tauri invoke wrapper, cn util
│  └─ styles/globals.css             # Tailwind
├─ public/avatar/                    # 4-state avatar PNGs (사용자 제공)
├─ src-tauri/
│  ├─ tauri.conf.json
│  ├─ Cargo.toml
│  ├─ migrations/0001_init.sql       # sqlx::migrate!
│  ├─ capabilities/default.json
│  └─ src/
│     ├─ main.rs, lib.rs (builder/plugins)
│     ├─ state.rs (DI container)
│     ├─ error.rs
│     ├─ infra/{db,paths,secrets}.rs
│     └─ commands/settings.rs
└─ docs/                             # (M2~ 추가 예정)
```

---

## 마일스톤 진행 현황

- [x] **M0** 부트스트랩 — 무프레임 위젯 + DB 마이그레이션 + 키체인 골격 + 설정에서 OpenAI 키 저장
- [ ] **M1** MVP — 채팅 + 정적 아바타 4상태 + tool calling todo CRUD + 비용 미터
- [ ] **M2** Google OAuth (PKCE) + Calendar 동기화 + 자연어 일정 등록 + 자동 브리핑
- [ ] **M3** TTS + STT (Whisper / tts-1)
- [ ] **M4** 트레이/단축키/자동시작/자동업데이트/온보딩/코드사이닝

상세 계획: `~/.claude/plans/ai-clever-church.md`
