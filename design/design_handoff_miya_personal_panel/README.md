# Handoff: MIYA 개인 패널 리디자인 + 채팅 리스타일

## Overview
개인 어시스턴트 앱(채팅 / 일정 / 할 일 / 목표 / 비용 / 설정 탭 구조)의 UI 리디자인.
기존 "개인" 탭을 **일정 / 할 일 / 목표** 3개 탭으로 분리하고, 채팅 화면을 개선된 구조로 재설계했다.
비주얼은 Mucha/Art Nouveau 계열 디자인 시스템(아이보리 화이트 라이트 + Nocturne 다크, 골드/브론즈/세이지 포인트)을 따른다.

## About the Design Files
이 번들의 파일들은 **HTML로 제작된 디자인 레퍼런스**다 — 의도한 룩과 동작을 보여주는 프로토타입이며, 그대로 배포할 프로덕션 코드가 아니다.
할 일: 대상 코드베이스의 기존 환경(React, Vue 등)과 그 컨벤션/라이브러리로 **이 디자인을 재구현**하는 것. 환경이 아직 없다면 프로젝트에 맞는 프레임워크를 골라 구현한다.
`.dc.html` 파일은 브라우저에서 바로 열리는 프로토타입이다. 마크업(인라인 스타일)과 하단 로직 클래스(React 스타일 state)를 참고하면 된다.

## Fidelity
**High-fidelity.** 색·타이포·간격·상태가 최종 의도값이다. 픽셀 수준으로 맞추되, 코드베이스의 기존 컴포넌트 시스템으로 재구현할 것.

## Theming
- 모든 색은 CSS 커스텀 프로퍼티(`tokens.css`)로 정의. 라이트 = `:root`, 다크 = `.dark` 클래스 오버라이드.
- 테마 전환 = 루트 요소에 `.dark` 클래스 토글. 프로토타입 우상단 "Ivory / Nocturne" 토글 참조.
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

### 2. 일정 탭 (`개인 패널.dc.html` — tab "cal")
- 헤더: Cinzel 월 라벨("2026. 08."), 우측에 "Google 캘린더 연동됨" pill(세이지 점), ◀ / 오늘 / ▶ 버튼(28px, hover 골드 보더). 아래 골드 페이드 디바이더.
- 월간 그리드: 7열, gap 2px. 요일 헤더 Cinzel 10px(일=`--rose`, 토=`--teal`). 셀 min-height 56px, radius 4px: 오늘 = `--gold-soft` 보더 + `--primary` 숫자, 선택일 = `--halo` 배경 + `--gold` 보더, 타월 날짜 opacity .35. 이벤트 도트 5px(id별 teal/sage/rose/gold 로테이션, 최대 4개).
- 선택일 섹션: "8월 30일 일요일 · 오늘" 라벨 + N건 + "팝업으로 크게 보기 ↗"(상세 캘린더는 별도 팝업 가정) + "+ 일정 추가" 버튼.
- 일정 추가 폼(토글): 제목 input + 시작/종료 time input + 저장(`--accent` 배경). `--muted` 배경, `--gold-soft` 보더.
- 이벤트 행: 시간 블록 + 3px 컬러 바 + 제목, hover 시 수정/삭제 텍스트 버튼. 빈 날 = dashed 보더 "일정 없음".
- **연동**: 추가/수정/삭제는 Google Calendar API와 양방향 동기화.

### 3. 할 일 탭 (tab "task")
- 두 섹션: **반복 루틴**(`--teal` 아이콘) / **마감 있는 할 일**(`--rose` 시계 아이콘, 마감 오름차순 정렬). 캘린더 일정과 별개 데이터.
- 행: 체크박스(반복 = 원형, 마감 = 사각 radius 4px; 완료 = `--sage` 채움 + 체크, 행 opacity .5 + line-through) + 제목 13.5px + 메타 칩 행(10.5px pill):
  - 반복 주기 `↻ 매일`(`--teal`) / 소요 시간 `◷ 30분` / `난이도 하·중·상`(하=`--sage`, 중=`--gold`, 상=`--rose`) / 연결된 목표 `◎ 목표명`(`--halo` 배경 `--primary`, **클릭 시 목표 탭의 해당 로드맵으로 이동**)
  - 마감 칩: 오늘 = `--destructive` 배경 "오늘 마감"(행 보더도 `--rose`), 7일 내 = "D-n", 그 외 "M/D 마감".
- 추가 폼: 반복/마감 타입 토글(pill, 활성 = `--accent`) → 제목, 예상 소요(15분~3시간+), 난이도(하○/중◐/상●), 연결된 목표(select), 반복 주기 또는 마감일(date).

### 4. 목표 탭 (tab "goal")
- **목록**: 목표 카드(골드 헤어라인 이중 프레임) — Cinzel 목표명 + "목표 시점 YYYY. MM.", 진행 바(5px, `--muted` 트랙에 `--gold-soft`→`--gold` 그라데이션) + % (`--primary`, tabular-nums), "세부 목표 n/m · 연결된 할 일 n건".
- **상세(로드맵)**: 뒤로가기 → Cinzel 목표명 + 진행 바/% + "세부 목표 n/m 달성".
  - 세로 타임라인: 좌측 1.5px 레일 — 진행률%까지 골드, 이후 `--border`. 마일스톤 노드 17px 원(완료 = 골드 채움 + 체크, 클릭으로 토글).
  - 마일스톤 카드: 완료 = opacity .6 + line-through + "달성"(`--sage`) / 첫 미완료 = "지금 여기 ✦"(`--primary`) + `--gold-soft` 보더 + 연결된 미완료 할 일 칩 표시 / 이후 = "예정"(`--muted-foreground`).
  - 하단: 세부 목표 추가 input + 버튼.
- 진행률 = 완료 마일스톤 / 전체 (모든 표시가 이 값에서 파생).

## Interactions & Behavior
- 탭 전환: 즉시 전환 + `growIn` 등장(opacity/translateY 4px, .25s ease).
- hover: 카드/행은 보더가 `--gold`로, 버튼은 brightness(1.1). 트랜지션 .15~.3s ease.
- 진행 바 width 변경: .5s ease.
- 할 일의 목표 칩 클릭 → 목표 탭 + 해당 목표 상세 오픈 (`stopPropagation` 필요).
- 일정 "수정" = 기존 값을 폼에 채우고 원본 제거 후 재저장(프로토타입 동작; 실서비스는 in-place 수정 권장).
- CJK 라벨/칩/pill에는 `white-space: nowrap` 필수 (폰트 로드 타이밍에 2줄로 꺾이는 버그 다발 — 프로토타입에서 실제로 반복 발생).

## State Management (프로토타입 기준)
- `theme` ("ivory"|"nocturne"), `tab` ("cal"|"task"|"goal")
- 일정: `calY/calM`, `selDate`, `events[{id,date,start,end,title}]`, 폼 상태
- 할 일: `tasks[{id,type:"rec"|"dl",title,done,minutes,diff,goalId,cycle?,due?}]`, 폼 상태
- 목표: `goals[{id,name,target,milestones[{id,title,done,note}]}]`, `selGoal`
- 파생값(진행률, D-day, 정렬, 캘린더 셀)은 전부 렌더 시 계산 — 저장하지 말 것.

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

- 타이포: 디스플레이/라벨 = `Cinzel`(라틴) + `Nanum Myeongjo`(한글 폴백), letter-spacing .06em(대형)/.1~.18em(eyebrow). UI 본문 = `Inter` + `Noto Sans KR`. 크기: 탭 13px, 본문 13.5~14px, 메타/칩 10.5~11.5px, 섹션 타이틀 24px.
- radius: 카드/버튼 4~6px, 칩/pill 99px. 숫자는 `font-variant-numeric: tabular-nums`.
- 그림자: 패널 `0 30px 70px -24px rgba(46,36,25,.45)` 1개만. 내부 위계는 그림자 대신 보더+배경 레이어로.

## Assets
외부 에셋 없음. 아이콘은 전부 인라인 SVG(stroke 1.1~1.5px, currentColor 또는 토큰) — 코드베이스의 아이콘 시스템으로 대체 가능. 폰트는 Google Fonts (Cinzel, Nanum Myeongjo, Noto Serif KR, Inter, Noto Sans KR).

## Files
- `tokens.css` — 디자인 토큰 (라이트/다크)
- `채팅 (Parchment).dc.html` — 채팅 화면
- `개인 패널.dc.html` — 일정/할 일/목표 3탭 (인터랙션 로직 포함)
