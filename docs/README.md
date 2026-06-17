# 문서 허브

이 폴더의 문서를 "언제 보면 되는지" 기준으로 정리한 인덱스.
긴 글은 각 폴더에, 설계 결정 단건은 `DECISIONS.md`(D-번호)에, 그날그날 작업은 `worklog/`에.

> 분류 기준은 [Diátaxis](https://diataxis.fr/) 변형 — 설명(왜)·참조(정확히 뭔지)·가이드(어떻게)·계획·기록.

## 빠른 길잡이

| 상황 | 보면 되는 문서 |
|---|---|
| 처음 개발 환경 세팅 | [guides/SETUP.md](./guides/SETUP.md) |
| 시스템 전체 구조가 궁금 | [architecture/OVERVIEW.md](./architecture/OVERVIEW.md) |
| DB 테이블/스키마 확인 | [architecture/DATA-MODEL.md](./architecture/DATA-MODEL.md) |
| 채팅 에이전트가 쓰는 도구 | [reference/CHAT-AGENT-TOOLS.md](./reference/CHAT-AGENT-TOOLS.md) |
| 클라우드(Fly) 배포 절차 | [guides/DEPLOY.md](./guides/DEPLOY.md) |
| "왜 이렇게 결정했지?" | [DECISIONS.md](./DECISIONS.md) |
| 지금 어디까지 됐지 / 다음 뭐 하지 | [planning/STATUS.md](./planning/STATUS.md) · [planning/ROADMAP.md](./planning/ROADMAP.md) |

## 폴더 구조

```
docs/
  README.md            ← (이 파일) 문서 허브
  DECISIONS.md         ← 설계 결정 기록 (D-번호, 코드 주석에서 직접 참조하는 앵커)
  architecture/        ← 왜·어떻게 (Explanation)
    OVERVIEW.md          시스템 개요 / 프로세스·IPC 흐름
    DATA-MODEL.md        DB 스키마 / 마이그레이션 개요
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
