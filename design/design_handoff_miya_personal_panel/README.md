# Handoff: MIYA 개인 패널 리디자인 + 채팅 리스타일

## Overview
개인 어시스턴트 앱(채팅 / 일정 / 할 일 / 목표 / 비용 / 설정 탭 구조)의 UI 리디자인.
기존 "개인" 탭을 **일정 / 할 일 / 목표** 3개 탭으로 분리하고, 채팅 화면을 개선된 구조로 재설계했다.
비주얼은 Mucha/Art Nouveau 계열 디자인 시스템(파치먼트 라이트 + Nocturne 다크, 골드/브론즈/세이지 포인트)을 따른다.

## About the Design Files
이 번들의 파일들은 **HTML로 제작된 디자인 레퍼런스**다 — 의도한 룩과 동작을 보여주는 프로토타입이며, 그대로 배포할 프로덕션 코드가 아니다.
할 일: 대상 코드베이스의 기존 환경(React, Vue 등)과 그 컨벤션/라이브러리로 **이 디자인을 재구현**하는 것. 환경이 아직 없다면 프로젝트에 맞는 프레임워크를 골라 구현한다.
`.dc.html` 파일은 브라우저에서 바로 열리는 프로토타입이다. 마크업(인라인 스타일)과 하단 로직 클래스(React 스타일 state)를 참고하면 된다.

## Fidelity
**High-fidelity.** 색·타이포·간격·상태가 최종 의도값이다. 픽셀 수준으로 맞추되, 코드베이스의 기존 컴포넌트 시스템으로 재구현할 것.

## Theming
- 모든 색은 CSS 커스텀 프로퍼티(`tokens.css`)로 정의. 라이트 = `:root`, 다크 = `.dark` 클래스 오버라이드.
- 테마 전환 = 루트 요소에 `.dark` 클래스 토글. 프로토타입 우상단 테마 토글 참조.
- **절대 하드코딩하지 말고 토큰을 쓸 것.**

## Screens / Views

### 1. 채팅 (`채팅 (Parchment).dc.html`)
- **패널**: 660×960, `--card` 배경, 1px `--border`, radius 6px. 패널 안쪽 5px에 골드 헤어라인(1px `--gold`, opacity .3) — 이 이중 프레임이 시스템의 시그니처.
- **타이틀바**: `--sidebar` 배경, 하단 1px `--border`. 탭(채팅·일정·할 일·목표·비용·설정): 13px, 활성 = `--muted` 배경 + `--foreground`, 비활성 = `--muted-foreground`, hover `--muted`. 우측: 테마 토글 pill, 최소화/닫기(닫기 hover = `--destructive` 배경).
- **대화 영역**: `--background` 배경(패널과 대비), padding 20px 22px.
  - 날짜 구분선: 골드 그라데이션 라인 + 가운데 Cinzel 11px 라벨.
  - 어시스턴트 아바타: 28px 원형, 1px `--gold` 보더, Cinzel "M" 이니셜, `--primary` 색.
  - 어시스턴트 버블: `--card` 배경, 1px `--border`, radius `2px 10px 10px 10px`(좌상단 꼬리), padding 13px 15px. 본문 14px/1.7, `--foreground`. 강조는 `--primary`.
  - 사용자 버블: `--primary` 배경, `--primary-foreground` 텍스트, radius `10px 2px 10px 10px`, 우측 정렬. 아래 타임스탬프 + 골드 이중 체크(읽음).
  - 메시지 액션(응답 하단, 1px `--border` 위): 복사 / 다시 생성 / 도움됨 — 11.5px `--muted-foreground`, hover `--primary`(도움됨은 `--sage`).
  - 구조화 카드(일정/할 일): 버블과 같은 스타일 + 안쪽 3px 골드 헤어라인(opacity .22). 헤더 = Cinzel 11.5px 라벨 + 카운트 pill(`--halo` 배경 `--primary` 텍스트). 일정 행 = 시작/종료 시간(tabular-nums) + 3px 컬러 바(`--teal`/`--gold`/`--sage`) + 제목/메타. 할 일 행 = 16px 체크박스 + 제목 + 마감 pill(긴급 = `--destructive` 배경). 카드 푸터 버튼: primary(`--primary` 배경) / secondary(`--secondary`).
  - 타이핑 인디케이터: 골드 점 3개, `dotPulse` 1.2s(각 .18s 딜레이).
- **입력부**: 퀵 리플라이 칩(pill, `--card` + `--border`, hover 골드 보더) 행 + 컴포저 카드(골드 헤어라인, `/일정` 슬래시 명령 힌트, 마이크/첨부 아이콘, "⏎ 전송 · ⇧⏎ 줄바꿈" 힌트, `--primary` 전송 버튼).

### 2. 개인 패널 공통 (`개인 패널.dc.html` — 520×680, 일정/할 일/목표 3탭)
- 탭별 대제목 없음 — 바로 콘텐츠 시작. 콘텐츠 패딩 14/16px, 큰 제목 19px/700(산세리프).
- 섹션 헤더 통일 패턴: 11px/600/자간 .12em `--muted-foreground` 라벨 + 헤어라인 + 우측 24px 기어 아이콘(편집 중 = `--halo` 배경 + `--primary`).
- 추가 패턴: 점선 보더 전체폭 행 "+ 새 … 추가"(hover 골드 보더).
- 편집(설정) 영역은 한 번에 하나만 열림(`editSection`).
- 카운트 문구("n건", "n/m") 표시 금지.

### 3. 일정 탭 (tab "cal")
- 헤더: 월 라벨 + "Google 연동됨" pill(세이지 점) + ◀/오늘/▶.
- 월간 그리드: 셀 min-height 40px, 이벤트 도트 4px(id별 teal/sage/rose/gold 로테이션). 오늘 = `--gold-soft` 보더 + `--primary` 숫자, 선택일 = `--halo` 배경 + `--gold` 보더, 타월 opacity .35.
- 선택일 섹션: 날짜 라벨 + "팝업으로 크게 보기 ↗"(상세 캘린더는 별도 팝업 가정) + "+ 일정 추가" 폼(제목/시작/종료). 이벤트 행: 시간 블록 + 3px 컬러 바 + 제목, hover 시 수정/삭제.
- **연동**: 추가/수정/삭제는 Google Calendar API와 양방향 동기화.

### 4. 할 일 탭 (tab "task")
- 맨 위 점선 "+ 새 할 일 추가" → 폼(반복/마감 토글, 예상 소요 15분~3시간+, 난이도 하○/중◐/상●, 연결 목표 select, '언제' 또는 마감일). 캘린더 일정과 별개 데이터.
- 세 섹션: **반복 루틴** / **마감 있는 할 일**(마감 오름차순) / **완료된 할 일**(접이식 ▾).
- **반복 루틴은 빈도 개념 없음** — 매일 전제, `cycle`은 트리거(일어나자마자/아침/이동 간/점심 후/저녁/자기 전/틈틈이). 칩엔 트리거만 표시("매일"·"주 n회" 문구 금지).
- 행: 체크박스(반복 = 원형, 마감 = 사각; 완료 = `--sage` 채움) + 제목 13.5px + 메타 칩 10.5px pill(트리거 `--teal` / `◷ 30분` / `난이도 하·중·상`(하=`--sage`, 중=`--gold`, 상=`--rose`) / 연결 목표 `◎`(`--halo` 배경, **클릭 시 목표 상세로 이동**)). 마감 칩: 오늘 = `--destructive` "오늘 마감"(행 보더 `--rose`), 7일 내 D-n, 그 외 "M/D 마감".
- 완료 섹션 헤더 우측 쓰레기통 아이콘 = 완료 전체 비우기(hover `--destructive`). 체크/해제 시 섹션 간 이동.

### 5. 목표 탭 (tab "goal")
- **목록** = 불릿 리스트(카드 아님): 골드 불릿(0% 빈 원 → 진행 중 `--gold-soft` → 100% `--gold`) + 목표명 14px + 첫 이유 한 줄(세리프 11px, 말줄임) + 64px 미니 진행 바 + % + ›. 헤어라인 구분, hover `--muted`.
- 맨 위 점선 "+ 새 목표 추가" → 목표명 + 시점 + 이유(선택), 저장 시 상세로 이동.
- **상세 화면** 순서(고정): 큰 제목 → ① 목표를 이루고 싶은 이유 → ② 이정표 → ③ 꾸준한 노력. 세 섹션 모두 통일 헤더 + 기어 편집.
  - **이유**: 보기 = 골드 불릿(·) 세리프 12px 목록, 기본 2개 + "+n개 더보기/접기". 편집 = 항목별 input + ✕ + "새 이유 추가". 데이터 `whys: string[]`.
  - **이정표**: 헤더 헤어라인 자리에 4px 진행 바 + %. 본문은 **산길(ascent) SVG** — 좌하단→우상단 오르는 곡선, 노드 수 n에 따라 자동 배치(x 8~92%, y 선형 하강, 높이 max(190, 46n+66)px, 세그먼트는 수평 제어점 cubic). 곡선 아래 `--halo` 30% 채움. 지나온 구간 = 골드 실선, 남은 구간 = 성긴 점선(dasharray 1.5 6). 달성 노드 = 15px 골드 채움 + 체크, 현재 = 19px + 글로우 링(0 0 0 4px `--halo`) + 골드 점, 예정 = 빈 원. 마지막 노드 위 골드 깃발. 라벨은 노드 아래 중앙(nowrap, 첫/마지막 -20%/-80% 시프트, 현재 노드는 간격 17px, 나머지 12px): 달성 = 취소선, 현재 = 골드 알약 pill(제목만), 예정 = 회색 텍스트. 노드 클릭 = 달성 토글.
  - **이정표 편집**: 순번 + 제목 input + ↑↓ 순서 변경 + ✕ 삭제 + "새 이정표 추가".
  - **꾸준한 노력**: 보기 = 체크 행(원형 체크 + 제목 + 트리거) 헤어라인 리스트 — 할 일 탭과 같은 데이터의 다른 뷰(체크 실시간 연동). 편집 = 전체 반복 할 일 체크박스 목록(이 목표에 연동/해제) + 이 목표 전용 새 루틴 추가(제목 + 트리거 select).
- 진행률 = 완료 이정표/전체.

## Interactions & Behavior
- 탭 전환: 즉시 전환 + `growIn` 등장(opacity/translateY 4px, .25s ease).
- hover: 행은 `--muted` 배경 또는 골드 보더, 버튼은 brightness(1.1). 트랜지션 .15~.3s ease.
- 이정표 토글 애니메이션: 골드 구간 페이드인(.6s), 체크/현재 점 팝(checkPop .35s, scale .4→1.25→1), 달성 라벨 취소선은 ::after로 width 0→100%(strikeIn .45s), 현재 pill growIn, 노드 속성 .3s 트랜지션. **주의**: SVG 선 그리기(dasharray+pathLength) 트릭은 non-scaling-stroke와 충돌해 중간에 끊기므로 사용 금지.
- 할 일의 목표 칩 클릭 → 목표 탭 + 해당 목표 상세 오픈 (`stopPropagation` 필요).
- 일정 "수정" = 기존 값을 폼에 채우고 원본 제거 후 재저장(프로토타입 동작; 실서비스는 in-place 수정 권장).
- CJK 라벨/칩/pill에는 `white-space: nowrap` 필수 (폰트 로드 타이밍에 2줄로 꺾이는 버그 다발 — 프로토타입에서 실제로 반복 발생).

## State Management (프로토타입 기준)
- `theme` ("parchment"|"nocturne"), `tab` ("cal"|"task"|"goal"), `editSection` (null|"why"|"ms"|"routine")
- 일정: `calY/calM`, `selDate`, `events[{id,date,start,end,title}]`, 폼 상태
- 할 일: `tasks[{id,type:"rec"|"dl",title,done,minutes,diff,goalId,cycle?(트리거),due?}]`, `showDone`, 폼 상태
- 목표: `goals[{id,name,target,whys:string[],milestones[{id,title,done}]}]`, `selGoal`, `whyExpanded`, `newWhy/newMs/rTitle/rCycle`
- 파생값(진행률, D-day, 정렬, 캘린더 셀, 산길 좌표/경로)은 전부 렌더 시 계산 — 저장하지 말 것.

## Design Tokens
전체는 `tokens.css` 참조(라이트 `:root` + 다크 `.dark`, 39개). 핵심:

| 토큰 | 라이트 | 다크 |
|---|---|---|
| --background | #F6F5F2 | #17130E |
| --card | #FFFFFF | #1F1A13 |
| --foreground | #26221C | #EDE3D0 |
| --muted / --muted-foreground | #EFEDE8 / #6E675C | #262019 / #A3947B |
| --border | #E5E1D9 | #34291D |
| --primary (브론즈/골드) | #7F5B18 | #D9B36B |
| --accent (버디그리) | #3E6B6B | #6FA5A1 |
| --destructive (테라코타) | #9E4F45 | #D9A08E |
| --sage / --rose / --teal | #5E6E44 / #9E4F45 / #3E6B6B | #9AAC7C / #D9A08E / #6FA5A1 |
| --gold / --gold-soft / --halo | #B99247 / #E0D3AC / #F4EEDE | #A88544 / #6E5628 / #2A2115 |
| --sidebar | #FBFAF8 | #120F0B |

- 타이포: **개인 패널은 산세리프 중심** — 제목/라벨 포함 `Inter` + `Noto Sans KR`(큰 제목 19px/700/자간 -.01em, 섹션 라벨 11px/600/자간 .12em). 예외: 목표 '이유' 본문은 세리프(`--font-serif`). 채팅 화면의 디스플레이/날짜 라벨은 `Cinzel` + `Nanum Myeongjo` 유지. 크기: 탭 13px, 본문 13~14px, 메타/칩 10.5~11.5px.
- radius: 카드/버튼 4~6px, 칩/pill 99px. 숫자는 `font-variant-numeric: tabular-nums`.
- 그림자: 패널 `0 30px 70px -24px rgba(46,36,25,.45)` 1개만. 내부 위계는 그림자 대신 보더+배경 레이어로.

## Assets
외부 에셋 없음. 아이콘은 전부 인라인 SVG(stroke 1.1~1.5px, currentColor 또는 토큰) — 코드베이스의 아이콘 시스템으로 대체 가능. 폰트는 Google Fonts (Cinzel, Nanum Myeongjo, Noto Serif KR, Inter, Noto Sans KR).

## Files
- `tokens.css` — 디자인 토큰 (라이트/다크)
- `채팅 (Parchment).dc.html` — 채팅 화면
- `개인 패널.dc.html` — 일정/할 일/목표 3탭, 520×680 (인터랙션 로직 포함, 최종 스펙)
