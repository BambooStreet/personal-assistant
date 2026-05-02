# Decision Log

큰 의사결정과 그 이유를 기록한다. "왜 그렇게 했지" 자문 시 빠른 참조용.

---

## D-001 — Tauri → Electron 전환

**일자**: 2026-04 초

**결정**: 1.0 출시 전 클라이언트를 Tauri v2에서 Electron + Rust 코어 사이드카로 전환.

**이유**
- 아바타가 핵심 브랜드 경험으로 자리잡으면서 Live2D, 표정/립싱크, 사용자 커스터마이징 같은 요구가 예상됨. 이쪽 생태계(pixi-live2d-display, Lottie 등)는 Electron/순수 웹에 더 풍부.
- AI 어시스턴트 런타임으로 확장 (도구 연결, 에이전트 자율성)에 Node 기반 Main이 자료/패키지 면에서 유리.
- 상용 배포 운영 (자동 업데이트, 크로스 플랫폼 QA, 렌더링 재현성)에서 Electron이 검증된 패턴 다수.

**대안 검토**
- Tauri 유지: 가벼움/번들 크기 장점이 있으나 위 요구사항을 다 흡수하기엔 생태계 격차 존재.
- Tauri 1.x 그대로 + 점진 확장: WebView 의존성 (WebView2 / WKWebView)으로 인한 렌더 일관성 이슈.

**트레이드오프**
- 번들 크기 증가 (~10MB → ~150MB+)
- 메모리 사용량 증가
- 그러나 Rust 비즈니스 로직은 100% 유지 — pa-core 사이드카로 그대로 이식

---

## D-002 — Rust 코어를 사이드카로 분리

**일자**: 2026-04 초

**결정**: 비즈니스 로직 (commands/services/infra)은 standalone Rust 바이너리로 빌드. Electron Main이 child_process로 spawn, stdio JSON-RPC 2.0 (NDJSON)으로 통신.

**이유**
- 기존 Rust 코드 재사용 (M0~M3에서 안정화된 sqlx + keyring + reqwest + oauth2 스택)
- Renderer/Main/Core 3-tier 분리 명확 — 각 계층이 단일 책임
- stdio는 크로스플랫폼 단순성 (named pipe / UDS 불필요), 백프레셔 무료, stderr를 로그로 분리 가능

**대안 검토**
- N-API 네이티브 모듈: Tauri의 `tauri::command` 매크로 의존 제거가 한 번에 안 됨. Electron 빌드/Node 버전 별 ABI 호환 부담.
- HTTP loopback: 포트 충돌, 보안 검사 통과 부담, OAuth 외 다른 기능에 과한 인프라.

**참고**
- Core 측: 요청별 `tokio::spawn`으로 동시성, stdout 쓰기는 `Mutex<Stdout>`으로 직렬화
- Main 측 supervisor: `Map<id, {resolve, reject}>`로 매칭, crash 시 exponential backoff 재시작 (최대 3회)

---

## D-003 — 사용자 데이터 경로/키체인 호환 명시 고정

**일자**: 2026-04

**결정**: Electron의 productName/appId 결정에 의존하지 않고 `app.setPath('userData', <legacy Tauri 경로>)`로 명시 고정.

**이유**
- Tauri 시절 사용자가 만든 SQLite DB / OS 키체인 항목이 그대로 호환되어야 함 (재로그인/재설정 강제 X)
- Electron 빌드의 productName이 향후 바뀌어도 사용자 데이터 경로는 안전

**경로**
- Windows: `%APPDATA%\dev.ohmyhong.personalassistant`
- macOS: `~/Library/Application Support/dev.ohmyhong.personalassistant`
- 키체인 SERVICE: `dev.ohmyhong.personalassistant`

---

## D-004 — 위젯을 두 개의 BrowserWindow로 분리

**일자**: 2026-05

**결정**: avatarWindow (144×144) + panelWindow (360×416)를 별도로 만들어 독립적으로 드래그 가능하게.

**이유**
- 단일 윈도우 + 패널 토글 시 setBounds로 윈도우 자체가 리사이즈되며 한 프레임 동안 시각 회귀 (아바타가 점프)
- 리사이즈 anchor 로직이 quadrant + 좌표 정규화로 복잡해지고 회귀 잡기 어려움
- 두 윈도우로 분리하면 각자 자기 드래그/위치만 관리. 상태 동기화는 Main의 broadcast 패턴이 깔끔

**트레이드오프**
- BrowserWindow 인스턴스 2개 (메모리 ~100MB 추가)
- 윈도우 간 state 동기화 인프라 필요 (구현됨)
- Renderer 코드 분기 (`?w=avatar|panel`) — main.tsx에서 라우팅

---

## D-005 — panelWindow는 hide가 아닌 offscreen-park

**일자**: 2026-05-03

**결정**: panel을 닫을 때 `hide()` 대신 화면 밖(`-20000, -20000`)으로 위치만 옮김. 윈도우는 항상 visible.

**이유**
- Windows에서 transparent + frame:false BrowserWindow의 첫 `show()` 시 한 프레임 동안 흰 배경/미렌더 상태가 보이는 알려진 이슈 (Electron layered window 합성 문제)
- offscreen-park하면 show/hide 사이클 자체가 없어 첫-show flicker 발생 안 함
- setIgnoreMouseEvents 초기 설정이 유지되어 offscreen에서도 자연스러운 클릭 통과

**트레이드오프**
- 윈도우가 항상 메모리 상주 (현재 구조에서도 어차피 hide도 destroy는 아니므로 동일)

---

## D-006 — 4분면 자동 회전 로직 제거

**일자**: 2026-05-03

**결정**: 패널이 모니터 위치에 따라 위/아래/좌/우 자동 결정되는 로직(decideQuadrant + shiftWindow)을 통째로 제거. 패널은 항상 아바타 위로 등장.

**이유**
- 4분면 변경 시 윈도우 리사이즈 + 좌표 보정의 복잡도가 시각 회귀(아바타 점프)의 주 원인
- 사용자가 "복잡하지 말고 간단히, 아바타 위에 살짝 겹쳐 등장" 명시 요청
- 두 윈도우 분리 + 사용자 드래그 자유 이동으로 상호 위치 조정 부담 사용자에게 위임

**대안 검토**
- 좌표 정규화/DPI 보정 강화: 회귀 잡기 까다로움, 계속 수정해도 엣지 케이스 발생
- koffi + Win32 SetWindowRgn (Tauri 1:1 동등): Windows-only, ROI 낮음

---

## D-007 — Hit-region 대신 setIgnoreMouseEvents 사용

**일자**: 2026-05

**결정**: 투명 영역 클릭 통과를 위해 OS-level hit-region (Win32 SetWindowRgn) 대신 Electron의 `setIgnoreMouseEvents(true, {forward: true})` + Renderer 호버 추적으로 토글.

**이유**
- 크로스플랫폼 (Windows/macOS 동일 코드)
- Renderer가 cursor 아래 요소가 `data-clickable=true`인지 검사해 동적으로 결정
- `forward: true` 덕에 무시 모드에서도 mousemove는 도착 → 다시 켤 수 있음
- 추가 native 라이브러리 (koffi, win32 FFI) 불필요

**트레이드오프**
- 매 mousemove마다 elementFromPoint + closest 호출 (성능 부담은 미미)
- 이론적으로 IPC 호출이 잦음 (state 변할 때만 호출하도록 디바운스)

---

## D-008 — 자동 업데이트 보류, 코드사이닝 결정과 함께

**일자**: 2026-05-03

**결정**: 1.0에선 `electron-builder` 패키징도 도입하지 않음. 자동 업데이트 + 코드사이닝 함께 1.x로 미룸.

**이유**
- 코드사이닝은 비용이 따라오는 결정 (Win EV $400~ + Apple Developer $99/년)
- 미서명 자동 업데이트는 매 업데이트마다 사용자에게 SmartScreen/Gatekeeper 경고
- 1.0 단계엔 dev 모드로 직접 사용하는 단일 사용자라 packaging이 필수가 아님

**대안 검토**
- 옵션 A (미서명 + 자동 업데이트 켬): 사용자 1명이라 SmartScreen 부담 적음. 단 README 가이드 필요
- 옵션 B (보류, 1.x): 선택됨

**향후 트리거**
- 사용자 베이스 늘어나서 packaging 필요 시
- 또는 코드사이닝 결제 결정 났을 때

---

## D-009 — Wake word는 브라우저 내 전이학습

**일자**: 2026-05-03

**결정**: `@tensorflow-models/speech-commands` (BROWSER_FFT 베이스) + transfer learning을 Renderer에서 직접. 학습된 head는 IndexedDB에 저장.

**이유**
- 사용자(ML/AI 전공)의 명시 요청 — 자체 모델로 가서 정확도 한계 시 Python 파이프라인으로 확장하는 경로 선호
- speech-commands 패키지가 collect/train/listen API를 빌트인으로 제공해 prototype 빠름
- 전이학습이라 적은 샘플 (호칭 8~10회)로도 prototype 동작 가능
- 데이터/모델 모두 로컬에 — 프라이버시 강함

**대안 검토**
- Picovoice Porcupine: 정확도/효율 압도적이나 무료 tier 제약, 커스텀 wake는 유료
- Vosk + 키워드 매칭: 풀 STT 항시 돌리는 부담
- 자체 CNN/MFCC: 학습/배포 파이프라인 직접 구축 — 1.0 범위 밖

**트레이드오프**
- 베이스 모델은 영어 명령어로 학습됨 — 한국어 호칭에 대한 일반화는 검증 필요
- 1초 spectrogram 윈도우라 긴 호칭("○○야~~")은 여러 윈도우에 걸칠 수 있음

**플랜 B**
- prototype에서 정확도 부족하면 YAMNet 임베딩 + 자체 헤드, 또는 Python에서 학습한 모델을 TF.js로 변환 → IndexedDB

---

## D-010 — 사용자 이름 호칭 인사 캐시

**일자**: 2026-05-03

**결정**: "네, ○○님" TTS는 메모리 캐시. 디스크 영속화는 1.x로.

**이유**
- prototype 검증엔 in-memory 충분 (앱 재시작 후 첫 wake에서 1~2초 지연)
- 디스크 캐시는 파일 IO + 무효화 로직 추가 부담

**향후**
- userData/audio_cache/greeting_${name_hash}.mp3로 캐시 영속화 — Phase C-2 또는 그 이후
