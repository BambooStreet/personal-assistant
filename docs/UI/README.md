# UI 도메인 문서

`apps/renderer`(React UI) + `apps/main`의 창/표시 동작에 대한 **현재 상태·불변식·gotcha·열린 이슈**.
why(결정 맥락)는 `docs/DECISIONS.md`, 시간순 변경은 `docs/worklog/`.

> 작업 전 이 폴더에서 해당 문서를 읽고, 작업 후 **바뀐 불변식이 있으면 같은 커밋에서 갱신**한다.
> 빈 스텁 문서는 만들지 않는다 — 지식이 쌓인 주제만 문서화하고, 그 전까진 아래 "예정"에 1줄로 둔다.

## 문서

- **[windowing.md](windowing.md)** — 아바타·패널 두 창 모델, 불투명/투명 규칙, offscreen-park,
  드래그·click-through, 재소환(트레이), 메인 프로세스 재시작 gotcha.

### 예정 (내용이 쌓이면 작성)

- `avatar.md` — 아바타 상태머신(idle/listening/thinking/speaking), 립싱크, long-press 드래그 모드.
- `layout-density.md` — 좁은 패널(520px)에서의 타이포·밀도 규칙.
- `motion.md` — 애니메이션 정책(현재 패널 등장 애니메이션은 불투명 창과 충돌해 제거됨).

## 열린 이슈 (백로그)

- [ ] **상단바·설정 글씨 작음** — 설정 화면이 `text-[10px]`/`[11px]` 다수. 최소 12px로 올리되 좁은
  패널 밀도(스크롤 증가) 보면서 조정. 라벨/뱃지보다 읽기 텍스트 우선. (→ 작성 시 `layout-density.md`)
- [ ] **패널 최소화→복원 시 모서리** — 네이티브 minimize/restore에서 둥근 모서리가 튀는지 실사용 관찰
  필요(현재까진 문제 보고 없음). 튀면 windowing.md 불변식 보강.
