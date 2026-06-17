# Personal Assistant

데스크톱 위젯형 AI 비서. Electron(main) + React(renderer) + Rust core 사이드카.
아바타·음성(STT/TTS)·캘린더·Todo·브리핑 중심.

## Architecture
- npm workspaces 모노레포. Renderer ↔ Main은 Electron IPC, Main ↔ Core는 stdio JSON-RPC.
- Core(`pa-core.exe`)는 별도 프로세스. Main이 supervisor로 띄움(apps/main/src/core/supervisor.ts).
- 데이터/상태는 모두 Core(Rust + SQLite). Renderer는 UI만, Main은 윈도우·OS 연동·forward만.

## Commands
- `npm run dev` — core 빌드 + types 빌드 + renderer/main 동시 실행
- `npm run build` — 전체 빌드 (core → types → renderer → main)
- `npm run build:core` — `cargo build --release --manifest-path core/Cargo.toml`
- `npm run typecheck` — 전 워크스페이스 tsc (테스트 러너는 아직 없음)
- `npm run package:win` — Windows 설치본(NSIS) 빌드
- 주 타깃은 Windows. macOS 분기 일부 존재(마이크 권한 등), Linux는 best-effort.

## IPC 변경 시 (중요)
새 IPC 메서드 추가/이름 변경 시 아래를 모두 일치시킬 것. 하나라도 빠지면 런타임에 깨짐:
1. `packages/ipc-types/src/methods.ts` — `Methods` + (core forward면) `CORE_FORWARD_METHODS`
2. `apps/main/src/preload.ts` — `api` 메서드
3. `apps/main/src/ipc.ts` — `forward(...)` 또는 커스텀 핸들러
4. `core/src/main.rs` — `dispatch` match arm
5. payload는 `packages/ipc-types/src/schemas.ts`에 zod로
- 메서드명은 `<domain>.<verb>` dot.case. Window/AutoLaunch/Debug는 Main 자체 처리(core forward 없음).

## 검증 (Verification)
변경 성격에 맞는 가장 싼 검증부터. 매번 전체 빌드 금지.
- TS 수정 → `npm run typecheck` (기본값)
- Core(Rust) 로직 변경 → `cargo test --manifest-path core/Cargo.toml`
- IPC 계약 / `ipc-types` / 마이그레이션 변경 → typecheck + 관련 빌드 필수
- 문서·주석·순수 UI 스타일 → 검증 생략 가능
- 전체 `npm run build`는 PR/패키징 직전에만

## Project Structure
- `apps/main/` — Electron 메인 프로세스(TS): 윈도우, 트레이, IPC, core supervisor, OAuth shell
- `apps/renderer/` — React UI(Vite + Tailwind): 아바타/채팅/Todo/브리핑/음성
- `core/` — Rust 코어: commands/, services/, infra/(db·oauth·secrets), migrations/
- `packages/ipc-types/` — Main↔Renderer↔Core 공유 계약(methods·schemas·events)

## Code Style
- IPC/RPC 메서드명은 dot.case, 그 외 TS는 camelCase. Rust는 표준 rustfmt.
- 코드 주석은 한국어 사용(기존 코드 관례).
- 설계 결정은 `docs/DECISIONS.md`에 D-번호로 기록(예: wake 텔레메트리 = D-012).

## Don't
- secrets / OS 키체인 값 로깅·커밋 금지(`core/src/infra/secrets.rs`).
- `core/target/`, `dist*`, `node_modules` 등 빌드 산출물 수정·커밋 금지.
- Renderer에서 직접 파일/DB 접근 금지 — 반드시 IPC 통해 Core로.

## Commit Convention
- Conventional Commits 형식: `<type>(<scope>): <subject>`
- type: feat, fix, docs, refactor, chore
- scope는 워크스페이스 기준: main, renderer, core, ipc-types, cloud-bot, core-rpc
- 제목은 한국어, 명령형, 50자 이내
- 예) `feat(core): 캘린더 동기화 추가`, `fix(ipc-types): todos.archive 스키마 누락 수정`

## Branch 전략
- **작은 수정은 `main`에서 바로** 작업·커밋: 버그 픽스(몇 줄~한 파일), 문서, 주석, 순수 스타일, 설정 한 줄.
- **큰 작업만 브랜치를 판다**: 여러 커밋에 걸치는 기능, 마이그레이션/IPC 계약 변경, 광범위 리팩터, 여러 워크스페이스 동시 변경. 이때만 `feat/…`·`fix/…` 브랜치 + PR.
- 1인 프로젝트 기준이라 작은 변경에 브랜치+PR은 과함 — 위 기준으로 판단.

## 개발 일지 (Worklog) — 푸시 시 필수
`origin`에 푸시할 때(특히 `main` 푸시 = 배포로 이어지는 경우)는 **그날짜 worklog에 변경 요약을 기록**한다. 푸시 직전 또는 직후 같은 턴에 함께 커밋.
- 파일: `docs/worklog/WORKLOG-YYYY-MM-DD.md` (그날 로컬 날짜). **이미 있으면 새 섹션으로 이어쓰기**, 없으면 생성(헤더 `# 작업 기록 — YYYY-MM-DD`).
- 내용: 무엇을·왜 바꿨는지 요약(파일 나열이 아니라 의도), 관련 **커밋 해시·D-번호·브랜치·PR** 참조, 미해결/후속 작업.
- 순수 사소한 푸시(오타·주석 한 줄)는 생략 가능. 기능/마이그레이션/IPC/배포 영향 변경은 반드시 기록.
- worklog 자체만 담는 푸시는 기록 불필요(무한루프 방지).