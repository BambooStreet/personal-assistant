# 아키텍처 개요

기록 시점: 2026-06-17.
이 문서는 시스템 전체를 5분에 잡는 그림이다. 상세 계약은 코드(`packages/ipc-types`,
`core/src/main.rs`)가 source of truth이고, 여기서는 **구조와 흐름**만 다룬다.

---

## 한 줄 요약

데스크톱 위젯형 AI 비서. **3-tier**: Electron Main(창·OS 연동) ↔ React Renderer(UI) ↔
Rust Core 사이드카(데이터·외부 API·비밀). 데이터/상태는 **전부 Core(Rust + SQLite)**,
Renderer는 UI만, Main은 윈도우·forward만.

---

## 프로세스 모델

```
┌─────────────────────── Electron 앱 ───────────────────────┐
│                                                            │
│  Renderer (React/Vite)         Main (Electron/Node)        │
│  - avatarWindow                - 윈도우 2개·트레이          │
│  - panelWindow                 - IPC 라우팅(forward)        │
│  - UI 상태(zustand)            - OAuth shell(openExternal)  │
│        │                       - Core supervisor           │
│        │ contextBridge                  │                  │
│        │ (window.api)                   │ stdio            │
│        └──────────► Main ◄──────────────┘ JSON-RPC(NDJSON) │
│                                          │                 │
└──────────────────────────────────────────┼────────────────┘
                                            ▼
                          ┌──────── pa-core.exe (Rust) ───────┐
                          │  rpc/ JSON-RPC 2.0 dispatch        │
                          │  commands/  (도메인별 핸들러)       │
                          │  services/  (llm·calendar·speech…) │
                          │  infra/     (db·oauth·secrets)     │
                          │  SQLite  +  OS 키체인  +  외부 API  │
                          └────────────────────────────────────┘
```

- **Core는 별도 프로세스.** Main이 supervisor로 spawn (`apps/main/src/core/supervisor.ts`).
- Main↔Core는 **stdio 위의 JSON-RPC 2.0(NDJSON, 한 줄=한 메시지)**.
- Core는 시작 30초 뒤 + 30분 간격으로 캘린더 동기화 polling (`SYNC_INTERVAL_SECS`, `main.rs`).
- 클라우드 모드(`PA_CORE_MODE=remote`)에서는 Main 대신 WS 게이트웨이를 통해 원격 Core에 붙는다
  (텔레그램 봇·폰 연동 경로 — `apps/cloud-bot`, `packages/core-rpc`).

## 책임 경계 (어디에 무엇이)

| 레이어 | 하는 일 | 하지 않는 일 |
|---|---|---|
| Renderer | UI 렌더, 입력 수집, 음성 사이클 | 파일/DB 직접 접근, 외부 API 직접 호출 ❌ |
| Main | 윈도우·트레이·단축키, IPC forward, OAuth shell | 비즈니스 로직·데이터 보관 ❌ |
| Core | DB·외부 API·비밀·도메인 로직 전부 | UI ❌ |

> 규칙: Renderer에서 직접 파일/DB 접근 금지 — 반드시 IPC 통해 Core로. (CLAUDE.md "Don't")

## IPC 4-레이어 (메서드 추가/변경 시 모두 일치)

`<domain>.<verb>` dot.case. 하나라도 빠지면 런타임에 깨진다.

1. `packages/ipc-types/src/methods.ts` — `Methods` (+ core forward면 `CORE_FORWARD_METHODS`)
2. `apps/main/src/preload.ts` — `api` 메서드
3. `apps/main/src/ipc.ts` — `forward(...)` 또는 커스텀 핸들러
4. `core/src/main.rs` — `dispatch` match arm
5. payload는 `packages/ipc-types/src/schemas.ts`에 zod로

> Window / AutoLaunch / Debug는 Main 자체 처리(core forward 없음).
> 드리프트 점검은 `ipc-aligner` 에이전트 사용.

## 핵심 흐름 — 채팅 한 턴

1. Renderer `chat.send` → Main forward → Core `chat_send`.
2. Core agent loop: LLM 호출 → 도구 호출이 있으면 **read-only는 자동 실행**, **write는 pending 반환**.
3. write 도구는 Renderer/봇에서 사용자 confirm → `chat.continue(approved)` → Core가 직접 실행(4b).
4. 도구 정의·실행 분기는 [reference/CHAT-AGENT-TOOLS.md](../reference/CHAT-AGENT-TOOLS.md) 참조.

## 데이터·비밀 위치

- **DB**: SQLite. `%APPDATA%\dev.ohmyhong.personalassistant\pa.sqlite` (Win).
  스키마는 [DATA-MODEL.md](./DATA-MODEL.md).
- **비밀**: DB에 저장 안 함. OS 키체인(`dev.ohmyhong.personalassistant`) — `core/src/infra/secrets.rs`.
  비밀값 로깅·커밋 금지.
- **멀티테넌시**: 전 테이블 `user_id`(공유 Core 한 프로세스가 전 유저 처리). 마이그레이션 0008·D-013.

## 관련 문서

- 데이터 모델: [DATA-MODEL.md](./DATA-MODEL.md)
- 채팅 도구: [reference/CHAT-AGENT-TOOLS.md](../reference/CHAT-AGENT-TOOLS.md)
- 설계 결정: [DECISIONS.md](../DECISIONS.md)
- 클라우드 배포: [guides/DEPLOY.md](../guides/DEPLOY.md)
