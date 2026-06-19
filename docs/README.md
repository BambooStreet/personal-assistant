# 문서 허브

이 폴더의 문서를 "언제 보면 되는지" 기준으로 정리한 인덱스.
긴 글은 각 폴더에, 설계 결정 단건은 `DECISIONS.md`(D-번호)에, 그날그날 작업은 `worklog/`에.

> 분류 기준은 [Diátaxis](https://diataxis.fr/) 변형 — 설명(왜)·참조(정확히 뭔지)·가이드(어떻게)·계획·기록.

## 빠른 길잡이

| 상황 | 보면 되는 문서 |
|---|---|
| 처음 개발 환경 세팅 | [guides/SETUP.md](./guides/SETUP.md) |
| 시스템 전체 구조가 궁금 | [architecture/OVERVIEW.md](./architecture/OVERVIEW.md) |
| 특정 도메인(UI 등) 동작·불변식·열린 이슈 | [도메인 지식 맵](#도메인-지식-맵) → 해당 폴더 |
| DB 테이블/스키마 확인 | [architecture/DATA-MODEL.md](./architecture/DATA-MODEL.md) |
| 채팅 에이전트가 쓰는 도구 | [reference/CHAT-AGENT-TOOLS.md](./reference/CHAT-AGENT-TOOLS.md) |
| 클라우드(Fly) 배포 절차 | [guides/DEPLOY.md](./guides/DEPLOY.md) |
| "왜 이렇게 결정했지?" | [DECISIONS.md](./DECISIONS.md) |
| 지금 어디까지 됐지 / 다음 뭐 하지 | [planning/STATUS.md](./planning/STATUS.md) · [planning/ROADMAP.md](./planning/ROADMAP.md) |

## 도메인 지식 맵

도메인별 **"지금 어떻게 동작하나 + 불변식 + gotcha + 열린 이슈"**가 어디 있는지 가리키는 라우터.
한 줄 요약 + 포인터만 둔다(상세는 도메인 문서로). 작업 착수 전 여기서 도메인 문서로 내려가 기획하고,
서브에이전트에 그 문서 경로와 함께 작업을 맡긴다.

> **계층**: 이 맵 + `CLAUDE.md`(라우팅) → 도메인 문서(현재 상태·불변식) → `DECISIONS.md`(교차-관심
> why) → `worklog/`(시간축). 판별: "도메인 하나만 알면 되나?" → 도메인 문서, "전 도메인?" → DECISIONS.

| 도메인 | 코드 | 문서 | 핵심 한 줄 |
|---|---|---|---|
| **UI** | `apps/renderer` + `apps/main` 창 | [UI/](./UI/README.md) | 아바타=투명 위젯, 패널=불투명 창. 패널은 hide() 금지 → offscreen-park. |
| **Main** | `apps/main` | *(미작성)* | Electron 껍데기·중계자. 로직 0, forward만. core supervisor 보유. |
| **Core** | `core/` (Rust) | *(미작성)* | 모든 상태 소유(SQLite). commands/services/infra. stdio JSON-RPC. |
| **DB** | `core/migrations` + 데이터모델 | [architecture/DATA-MODEL.md](./architecture/DATA-MODEL.md) | sqlx + 마이그레이션. 멀티테넌트(user_id) 진행 중. |
| **Server** | `apps/cloud-bot` + 클라우드 | *(미작성)* | 텔레그램 + SaaS(공유 Core). 데스크톱과 같은 두뇌 재사용. |

**결합조직 — IPC** (도메인 사이의 계약, 버킷 아님): 소유 = `packages/ipc-types`, 검증 = `ipc-aligner`
서브에이전트(읽기 전용 게이트키퍼). 규칙은 `CLAUDE.md`의 "IPC 변경 시".

미작성 칸은 그 도메인이 충분히 아파져(지식이 쌓여) 문서화 가치가 생기면 채운다 — 빈 스텁은 만들지 않는다.

## 폴더 구조

```
docs/
  README.md            ← (이 파일) 문서 허브
  DECISIONS.md         ← 설계 결정 기록 (D-번호, 코드 주석에서 직접 참조하는 앵커)
  architecture/        ← 왜·어떻게 (Explanation)
    OVERVIEW.md          시스템 개요 / 프로세스·IPC 흐름
    DATA-MODEL.md        DB 스키마 / 마이그레이션 개요
  UI/                  ← 도메인 지식 (현재 동작·불변식·gotcha·열린 이슈)
    README.md            UI 도메인 인덱스 + 백로그
    windowing.md         아바타·패널 창 모델
  reference/           ← 정확한 스펙 (Reference)
    CHAT-AGENT-TOOLS.md  채팅 에이전트 도구 세트
  guides/              ← 작업 방법 (How-to / 온보딩)
    SETUP.md             개발 환경 재현
    DEPLOY.md            Fly.io 배포·운영
  design/              ← 기능 설계 제안 (RFC류)
    CONVERSATION-PLAN.md
    CONVERSATION-REWORK.md
    SAAS-LAUNCH-PLAN.md
  planning/            ← 로드맵·상태
    ROADMAP.md
    STATUS.md
  worklog/             ← 날짜별 작업 기록
    WORKLOG-2026-06-15.md
```

## 문서 작성 원칙 (솔로 프로젝트)

- **코드가 진실인 건 문서로 복제하지 않는다.** IPC 메서드 목록·zod 스키마·DB DDL은
  코드(`packages/ipc-types`, `core/migrations`)가 source of truth. 문서는 "어디 보면 되는지 + 왜"만.
- **잘 안 변하는 것만 문서로.** 아키텍처·설계 결정(ADR)·데이터 모델 개요는 변동이 적어 가치가 높다.
- **새 문서를 만들면 이 인덱스에 한 줄 추가**한다(이 파일이 진입점).
- 설계 결정은 `DECISIONS.md`에 D-번호로(앵커라 이동 금지), 그날 작업은 `worklog/`에.
- **도메인 문서(`docs/<domain>/`)는 "현재 동작·불변식"의 정본** — 해당 동작을 바꾸면 *같은 커밋에서*
  갱신한다. `DECISIONS.md`는 교차-관심 결정만(도메인 고유 결정은 도메인 문서로). 빈 스텁은 금지.
