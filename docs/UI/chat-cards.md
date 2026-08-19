# 채팅 카드 (읽기 도구 결과 렌더)

채팅에서 할 일·일정 **목록을 누가 그리는가**에 대한 문서. 현재 동작·불변식·gotcha.

## 한 줄

목록은 **클라이언트가 카드로 그린다**. LLM 텍스트는 요약만 맡는다.

## 왜

이전에는 Core가 도구 결과 JSON을 손에 쥐고도 렌더러로 넘기지 않고, LLM에게 "표시 지침"을 줘서
텍스트로 다시 그리게 했다. 구조화된 데이터 → 텍스트 → 마크다운 렌더의 손실 경로라 (1) 모양이
투박하고 (2) 목록을 매 턴 모델이 받아쓰느라 토큰이 나가고 (3) 모델이 값을 틀릴 여지가 있었다.

## 흐름

```
Core: 읽기 도구 자동 실행 (services/llm/dispatch.rs)
  ├─ 결과 JSON을 tool 메시지로 DB 저장           → 히스토리 복원용
  └─ ChatTurn.tool_results 에 원본 그대로 실어 반환 → 라이브 렌더용
        │
        ├─ 데스크톱: buildCards() → ChatCards → 카드
        │    lib/chatCards.ts · components/chat/cards/*
        └─ 텔레그램: formatToolResults() → 평문 목록
             apps/cloud-bot/src/format.ts
```

Core는 **가공하지 않는다**. 도구가 낸 JSON 문자열을 그대로 넘기고, 표시 정규화는 클라이언트에서만.

## 현재 카드가 나오는 도구

| 도구 | 카드 |
|---|---|
| `list_todos` | 할 일 |
| `list_today_events` | 오늘 일정 |
| `list_upcoming_events` | 다가오는 일정(날짜별 그룹) |
| `list_today_overview` | 오늘 일정 + 할 일 (2장) |

`suggest_schedule` · `plan_travel` · `search_memory`는 아직 텍스트 전용 — 기존 표시 지침 유지.

### 쓰기 승인 직후 갱신 카드

할 일·일정을 추가/완료/삭제하면 `chat_continue`가 갱신된 목록을 카드 한 장으로 덧붙인다
(`fresh_list_after_write`). 읽기 도구를 그대로 재실행해 만들기 때문에 카드 파서는 손댈 게 없다.

- todo 계열 → `list_todos`, event 계열 → `list_upcoming_events`
- **연속 작업의 마지막 턴에만** 붙인다. 승인 대기 중인 쓰기가 남아 있으면
  (`turn.tool_calls`가 비어 있지 않음) 아직 끝난 게 아니므로 중간 목록을 띄우지 않는다 →
  "2건 삭제"는 마지막 마무리 안내와 함께 카드 한 장만 나온다
- 모델이 같은 턴에 이미 그 목록을 조회했으면 덧붙이지 않는다(카드 중복 방지)
- 쓰기가 실패하거나 사용자가 거부하면 붙이지 않는다
- **세션 한정**이다. tool 메시지로 저장하면 짝 없는 tool 호출이 되어 OpenAI 프로토콜이 깨지므로
  history에는 남기지 않는다. 대신 스토어가 `sessionCards`로 들고 있다가 `loadHistory`가 마지막
  assistant 버블에 되붙인다 → 패널 재마운트·탭 전환에도 카드가 유지된다. 앱을 껐다 켜면 사라진다.
- 합성 여부는 `tool_call_id`의 `refresh:` 접두사로 판별한다(`isSynthesizedRefresh`).
  **Core의 `fresh_list_after_write`와 짝** — 한쪽만 바꾸면 카드가 조용히 사라진다.

### 여러 건 쓰기 (한 턴 1건 제한)

`run_agent_loop`은 한 응답의 tool_call 중 **첫 쓰기까지만** 실행하고 나머지는 폐기한다(UI confirm이
1건 단위라서). 그래서 "기한 지난 할 일 다 지워줘"가 첫 건에서 끊기던 문제가 있었다 →
`WRITE_FOLLOWUP_HINT`를 쓰기 도구 결과에 붙여, 재개된 루프에서 남은 작업을 이어 호출하게 한다.
프롬프트 기반이라 100% 보장은 아니다([D-016]과 같은 결). 건별로 confirm 카드가 다시 뜬다.

## 불변식

- **표시 지침(`chat.rs`의 `*_PRESENT_HINT`)과 카드는 한 쌍이다.** 지침은 "나열하지 말고 요약만"을
  지시한다. 카드를 떼면 지침도 되돌려야 하고, 지침을 늘려 다시 나열하게 하면 화면에 같은 목록이
  두 번 나온다.
- **정규화는 `lib/chatCards.ts` 한 곳에서만.** 라이브 응답(`tool_results`)과 히스토리 복원
  (`role="tool"` 행) 두 경로가 같은 함수를 쓴다. 한쪽에만 로직을 넣으면 새로고침 시 카드가 달라진다.
- **빈 목록은 카드를 만들지 않는다.** "없어요"는 assistant 텍스트가 말한다.
- 검증은 **손으로 쓴 가드**로 한다. 필드가 어긋난 항목만 조용히 빠지고 채팅은 계속 동작한다.
  `@pa/ipc-types`의 zod 스키마를 런타임으로 쓰고 싶어도 **불가** — dist가 CJS(`__exportStar`)라
  Vite/Rollup이 named export를 정적 분석하지 못해 번들이 깨진다. 렌더러는 타입만 import한다.
- 타이포는 [README](README.md)의 밀도 규칙을 따른다(본문 `text-xs`, **12px 미만 금지**).

## Gotcha

- **새 카드를 추가하면 텔레그램 포맷터도 같이 고쳐야 한다.** 봇은 `assistant_text`만 렌더하므로,
  지침이 "요약만"인 상태에서 봇 포맷터를 빠뜨리면 **텔레그램에서 목록이 통째로 사라진다.**
  추가 지점 3곳: `chatCards.ts`의 `cardsForResult` case → 카드 컴포넌트 → `cloud-bot/format.ts`.
- **히스토리 카드는 `role="tool"` 행에 의존한다.** `chat.history`의 limit(기본 200) 밖으로 밀리거나
  `chat.clear` 후에는 카드가 사라지고 텍스트 요약만 남는다 — 의도된 열화(텍스트가 항상 fallback).
- 마무리 텍스트 없이 끊긴 턴의 tool 행은 다음 턴 버블에 붙지 않는다(user 메시지에서 리셋).
- **시각은 전부 UTC로 온다.** 카드는 `new Date()`로 OS 로컬 변환에 의존하고, 봇은 컨테이너
  `TZ=Asia/Seoul`([D-015])에 의존한다.
- **음성(TTS)은 `assistant_text`만 읽는다.** 목록이 카드로 빠졌으므로 음성으로는 "총 N건 + 급한 것
  한둘"만 들린다 — 설계상 의도된 분업.

## 열린 이슈

- [ ] 카드 상호작용(체크박스로 완료 처리, 항목 클릭 상세) — v1은 보기 전용.
- [ ] `suggest_schedule`(일과 추천) 카드 — 시간표 형태라 별도 디자인 필요.
- [ ] 카드가 12행을 넘으면 "+N건 더"로 접기만 한다. 펼치기 없음.
