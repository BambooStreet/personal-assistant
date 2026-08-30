# 윈도잉 (Windowing) — 아바타·패널 창

> **이 문서가 현재 동작의 정본(source of truth).** "왜 그렇게 정했나"의 역사적 맥락은
> 끝의 [결정 이력](#결정-이력) + `docs/DECISIONS.md`. 창/패널/아바타 동작을 바꾸면
> **같은 커밋에서 이 문서를 갱신**한다.
>
> 관련 코드: `apps/main/src/windows.ts`(창 생성·show/park), `tray.ts`(재소환),
> `apps/renderer/src/{PanelApp,AvatarApp}.tsx`, `components/widget/{BottomPanel,AvatarShell}.tsx`,
> `lib/useClickThrough.ts`, `styles/globals.css`(`.panel-card`).

## 한 줄 요약

데스크톱 위젯은 **두 개의 독립 BrowserWindow** — 성격이 정반대다: **아바타 = 투명 위젯**,
**패널 = 불투명 창**. 둘을 헷갈려 한쪽 규칙을 다른 쪽에 적용하면 깜빡임·드래그 문제가 난다.

## 1. 두 창 모델

| | **아바타** (`createAvatarWindow`) | **패널** (`createPanelWindow`) |
|---|---|---|
| 크기 | 200×200 | 520×680 |
| `transparent` | **true** (고양이 = 비사각형 모양이라 필수) | **false** (불투명, `backgroundColor: #121216`) |
| `frame` | false | false |
| `hasShadow` | false | **true** (OS 네이티브 창 그림자) |
| `roundedCorners` | — | **true** (Win11 DWM 네이티브 라운딩) |
| `skipTaskbar` | **true** (순수 위젯, 작업표시줄 안 뜸) | **토글** (닫힘=true / 열림=false) |
| alwaysOnTop | **true** (`"screen-saver"`) | 미적용(일반 창처럼 뒤로 감) |
| dev 시작 | 숨김(`startHidden = !app.isPackaged`, 트레이로 표시) | 숨김 → 화면 밖 park |

둥근 모서리는 **투명과 무관**하다 — Win11은 불투명 창도 둥글려 준다(카카오톡/브라우저와 동일).
그래서 패널은 불투명으로도 둥근 모서리를 유지한다.

## 2. 하드 불변식 (깨면 회귀)

1. **아바타=transparent, 패널=opaque.** 서로 반대. 패널을 투명으로 되돌리면 등장 깜빡임이
   돌아오고, 아바타를 불투명으로 바꾸면 고양이 주변이 사각 박스가 된다.
2. **패널은 `hide()`/`show()` 금지 → offscreen-park.** Win11에서 둥근 opaque 창을 hide/show하면
   OS 전환이 한 프레임 **모서리를 각지게(검정)** 보이거나 **흰 깜빡임**을 만든다. 그래서 창은
   항상 visible로 두고 "닫힘"은 화면 밖(`PANEL_PARK = -20000`)으로 위치만 옮긴다.
3. **불투명 패널엔 CSS 등장 애니메이션 금지.** opacity:0에서 시작하는 페이드인은 불투명 창에선
   "검은 배경 한 프레임 → 콘텐츠"로 보인다. 창이 콘텐츠와 함께 통째로 나타나야 한다.
4. **드래그 영역은 창 y=0까지 닿아야 한다.** `.panel-card`는 `border` 대신 **inset ring**을 쓴다
   (border는 box-sizing상 최상단 1px를 먹어 헤더 드래그 영역을 1px 아래로 민다). 추가로 PanelApp
   최상단에 **6px drag 스트립**을 깔아 DPI/창 상태와 무관하게 보장.
5. **작업표시줄은 패널만.** `setSkipTaskbar` 토글이 alt-tab도 좌우한다(`WS_EX_TOOLWINDOW`) — 닫힘
   상태(skipTaskbar=true)면 작업표시줄·alt-tab 양쪽에서 빠진다.
6. **Core가 broadcast하는 이벤트는 한 창에서만 소비한다.** `broadcast`는 두 창 모두에 팬아웃하므로
   양쪽이 같은 이벤트로 TTS를 내면 두 번 발화되고, 양쪽이 말풍선을 붙이면 두 개가 된다.
   현재 규칙: `notification.fired` / `routine.fired` / `greeting.fired` → **PanelApp만 구독**.
   같은 이유로 부팅 인사의 `greeting.run` 호출과 TTS는 **AvatarApp만** 한다(아래 참조).

### 부팅 시퀀스 — 누가 무엇을 하는가 (D-025)

두 창이 **같은 zustand 스토어 정의를 각자 인스턴스화**하기 때문에, "한 번만"을 스토어 플래그로
보장하려는 시도는 전부 실패한다(예전 `pendingAutoPlay`/`consumeAutoPlay`가 그랬다). 지금은
역할을 나눠서 막는다:

| | AvatarApp | PanelApp |
|---|---|---|
| `greeting.run` 호출 | ✅ 유일한 호출자 | ✗ |
| TTS 재생(인사 → 브리핑) | ✅ `speakSequence` | ✗ |
| 인사 말풍선 | ✗ | ✅ `greeting.fired` 구독 |
| 브리핑 카드 | ✗ | ✅ `briefing.today` 조회 |

최종 방어선은 렌더러가 아니라 **Core의 쿨다운 클레임**이다 — HMR·창 재생성으로 위 가드가 뚫려도
인사는 한 번만 나간다.

## 3. 패널 열기/닫기/최소화 (park 모델)

- **생성**: `show:false`로 만들고 화면 밖(`PANEL_PARK`)에 둔 뒤 `ready-to-show`에서 `showInactive()`
  한 번 — offscreen에서 미리 paint(가시화는 안 됨). `paintWhenInitiallyHidden` 기본값 덕에 콘텐츠가
  준비된다. 이후 등장은 **위치 이동만**.
- **열기** (`showPanel`): `setSkipTaskbar(false)` → 최소화면 `restore()` → 중앙 좌표 계산
  (`positionPanelCenter` + 상단 클램프 `clampPanelTop`) → onscreen으로 `setBounds` → `focus()`.
  **`show()` 호출 없음** (이미 visible).
- **닫기** (`hidePanel`, 헤더 ✕ = `window.setPanelOpen(false)`): `setSkipTaskbar(true)` → `PANEL_PARK`로
  `setBounds`. **`hide()` 호출 없음**. 작업표시줄 버튼 사라짐. 재소환은 트레이.
- **최소화** (헤더 ─ = `window.minimize` IPC): 네이티브 `minimize()`. 작업표시줄 버튼 유지, 클릭하면
  OS가 restore. (네이티브 최소화는 DWM이 둥근 모서리를 유지해 안전)
- **Alt+F4 / OS close**: `close` 이벤트를 가로채 `hidePanel`(park). 실제 종료는 트레이 "종료"만.

## 4. 드래그 / click-through

- **드래그**: JS 폴링 없이 `-webkit-app-region: drag`(헤더 = `BottomPanel`의 `<header>`)로 OS 네이티브
  처리. 인터랙티브 자식은 `no-drag`로 격리. (불변식 4 참조)
- **click-through**: 패널은 `setIgnoreMouseEvents(true, {forward:true})`로 생성. `useClickThrough`가
  `mousemove`마다 커서 아래 요소에 `data-clickable="true"` 조상이 있는지 검사해 토글. `forward:true`
  덕에 무시 모드에서도 mousemove는 도착.

## 5. 재소환 경로 (패널을 다시 여는 법)

작업표시줄이 아니라 **트레이가 안정적 경로** (`tray.ts`):
- 트레이 메뉴 **"패널 열기"** → `showPanel()` — **아바타가 숨겨져 있어도** 패널만 띄움.
- 트레이 **좌클릭** = 아바타 토글(패널 아님).
- "설정" 메뉴 → 패널을 설정 탭으로 엶.

아바타 작업표시줄 항목은 **아바타가 보이는 동안에만** 존재(dev는 시작 시 숨김)이라 재소환 수단으로
불안정 — 트레이를 쓴다.

## 6. Gotchas

- **메인 프로세스 변경은 완전 재시작 필요.** `windows.ts`는 Electron 메인이라 Vite 핫리로드로 안 바뀐다.
  변경 검증 시 `npm run dev`를 **Ctrl+C 후 재실행**.
- **분수 DPI**: transparent frameless가 show마다 1–2px 다르게 잡히는 현상이 과거 관찰됨 → 패널은
  매 등장 `setBounds`로 크기 재선언. 드래그 상단 px 손실도 같은 뿌리(불변식 4로 보강).
- **위치**: 패널은 항상 커서가 있는 디스플레이 중앙(`positionPanelCenter`), 상단이 잘리지 않게
  `clampPanelTop`으로 workArea.y 이상 클램프.

## 결정 이력

현재 동작은 위가 정본. 아래는 그 결정의 why(상세는 `docs/DECISIONS.md`):

- **[D-004]** 위젯을 두 BrowserWindow로 분리 — 단일 창 리사이즈 시 아바타 점프 회귀 회피.
- **[D-005]** 패널은 hide가 아닌 offscreen-park — transparent first-show 깜빡임 회피. (한때 hide/show로
  되돌렸다 재채택. 불투명 전환 후에도 park 유지 — 불변식 2의 둥근 모서리 아티팩트 때문.)
- **[D-006]** 4분면 자동 회전 제거 — 패널은 항상 아바타 위로 단순 등장.
- **[D-007]** hit-region 대신 `setIgnoreMouseEvents` — 크로스플랫폼 click-through.
- **[D-019]** 아바타=위젯(작업표시줄 제외)/패널=창(작업표시줄 포함) + 헤더 최소화·닫기. 이후 패널
  **불투명 전환**(깜빡임 원천 차단) + 등장 애니메이션 제거까지 진행 — 본 문서 1~3절이 그 최종형.
- **[D-025]** 부팅 인사/브리핑의 창 역할 분리 — 스토어 one-shot 플래그가 창마다 갈라져 중복
  재생을 못 막았다. 불변식 6과 위 표가 그 결과.
