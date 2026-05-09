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

---

## D-011 — IPC 채널명 단일 출처화

**일자**: 2026-05-05

**결정**: Renderer ↔ Main IPC 채널명과 Main ↔ Core JSON-RPC 메서드명을 **하나의 문자열 값**으로 통일하고, 그 값을 `@pa/ipc-types/methods.ts`의 `Methods` const에 한 번만 정의해 모든 사용처가 import해서 쓴다. 표기는 dot.case (`"app.health"`, `"chat.send"`).

**배경 (정리 전 상태)**
- 한 RPC가 4단계를 거치는데(컴포넌트 → preload → Main → Core) 채널 이름이 위치마다 따로 박혀 있었음 (preload `"setSecret"` / Main `ipcMain.handle("setSecret")` / Main 내부 `core.request("secret.set")` / core dispatch `"secret.set"`).
- camelCase(IPC) ↔ dot.case(core) 두 표기를 동시에 관리. 같은 동작에 두 이름.
- `@pa/ipc-types/methods.ts`에 `Methods` const는 있었지만 어떤 사용처도 import하지 않음. 게다가 드리프트 발생: `SpeechStt: "speech.stt"`인데 실제는 `speech.transcribe`. `WindowSetHitRegion`/`WindowOuterPosition` 등 Tauri 잔재가 남아 있음.
- forward 헬퍼는 `forward("setSecret", "secret.set")`처럼 2-arg, 21회 반복되는 `if (!core) throw` 보일러플레이트.

**이유**
- 새 채널 추가 비용을 4곳 → 1곳으로 (Methods에 한 줄).
- 채널명 오타를 컴파일 타임에 잡기 (`Methods.X`가 존재하지 않으면 TS 에러).
- 드리프트 자체를 발생시킬 수 없게.
- 두 표기를 한 표기로 단일화 → forward 헬퍼 1-arg, 보일러플레이트 21 → 4.

**대안 검토**
- camelCase로 통일: TS 진영엔 자연스러우나 core(JSON-RPC) 컨벤션은 dot.case.
- camelCase + dot.case 매핑 테이블 유지: 두 표기를 명시적으로 관리하나 결국 두 곳을 손대는 부담이 남음.
- dot.case로 통일 (선택됨): JSON-RPC 컨벤션과 일치, TS 키(`Methods.AppHealth`)는 별개 식별자라 불편 없음.

**구현**
- `@pa/ipc-types`를 실제로 build해서 `dist/`에 CJS 출력 (이전엔 `main: "src/index.ts"`였고 type-only import만 있었기 때문에 런타임에 require된 적 없음).
- `preload.ts`: `invoke(Methods.X, payload)`로 채널명 참조.
- `apps/main/src/ipc.ts`: 1-arg `forward(method, defaultPayload?)` 헬퍼가 ipcMain.handle 등록 + core.request 호출까지 동일 method 문자열로 처리. 27개 단순 메서드는 `forward(Methods.X)` 한 줄. 커스텀 핸들러는 `secret.set`(검증), `chat.send`(fan-out), `speech.transcribe`(macOS 마이크 권한) 3개만.

**트레이드오프**
- Rust core 측은 여전히 `match method { "app.health" => … }` 식 문자열 리터럴 매칭. TS의 `Methods` const를 Rust에서 직접 import 못 함 — 코드젠(스키마 → Rust enum) 도입 안 함.
  - 한계: TS에서 메서드명을 바꿔도 Rust dispatch는 사람이 직접 일치시켜야 함. 일치 깨지면 `method not found` 런타임 에러.
  - 향후 트리거: 채널 변경/추가가 잦아져 누락이 자주 생기면 그때 코드젠 도입.
- `@pa/ipc-types`가 빌드 산출물(`dist/`)을 갖게 됨 → 모든 dev/build 스크립트가 `build:types`를 선행 의존으로 가짐. Vite 의존 renderer는 영향 없으나 tsc 의존 main은 dist가 없으면 컴파일·실행 모두 실패.

**참고**
- 도입 커밋: `0574c99 Adopt @pa/ipc-types Methods registry as single source of truth + split main`
- 빌드 setup 후속 fix: `0c5e415 Build @pa/ipc-types to dist/ so main can require() it`

---

## D-012 — Wake telemetry NDJSON 스키마 + eval 보고서 컨벤션

**일자**: 2026-05-09

**결정**: wake word 검출 베이스라인 측정과 향후 모델 비교 평가용 텔레메트리를 NDJSON으로 `userData/debug/wake-scores-<sessionId>.ndjson`에 기록한다. 두 record type — `session`(파일 첫 줄, 1회) + `score`(매 inference frame). 별도 eval 코드베이스(`eval/`)에서 이 NDJSON을 입력으로 분석/보고서를 만든다.

**스키마 (v=1)**

session record — 첫 줄, 정확히 1회:
```json
{
  "type": "session",
  "v": 1,
  "session_id": "<uuid v4>",
  "started_at": "<ISO 8601 UTC>",
  "prod_commit_sha": "<git rev-parse HEAD>[+'-dirty']",
  "platform": { "os": "win32|darwin|linux", "arch": "x64|arm64", "electron": "<version>" },
  "model": {
    "backend": "speech-commands-tfjs",
    "labels": ["..."],
    "threshold": 0.98,
    "suppression_ms": 1500,
    "overlap": 0.5
  },
  "audio_chunk_hash_algo": "sha256-hex16"
}
```

score record — 매 frame:
```json
{
  "type": "score",
  "t_ms": <epoch ms>,
  "scores": { "<label>": <number>, ... },
  "audio_chunk_hash": "<16 hex chars>",
  "triggered": <bool>
}
```

**필드 의도**
- `prod_commit_sha` — 어떤 prod 코드 상태에서 측정됐는지. working tree 더러우면 `<sha>-dirty`. **빌드 시 Vite `define`으로 주입** (런타임 git 호출 없음).
- `session_id` — 측정 모드 토글 ON 시 `crypto.randomUUID()`로 새로 생성. 한 측정 세션 = 한 파일.
- `audio_chunk_hash` — 스펙트로그램 `Float32Array` 바이트의 SHA-256 앞 16hex(64-bit). raw PCM은 저장하지 않음 (용량+프라이버시). 같은 audio frame을 다른 모델로 재처리할 때 cross-reference용. 한 세션 내 충돌 무시 가능.
- `triggered` — 해당 frame이 prod의 threshold/suppression을 거쳐 wake fire를 일으켰는지 (eval에서 GT와 비교용).

**eval 보고서 컨벤션**

`eval/results/<YYYY-MM-DD>-<topic>.md`의 frontmatter에 입력 NDJSON sha256과 session_id를 박는다:
```
---
date: 2026-05-09
prod_commit_sha: 5fe2210...
input_ndjson_sha256: <sha256 of the .ndjson file>
input_ndjson_session_id: <uuid>
duration_min: 60
notes: "TV 30분 + 본인 발화 100회"
---
```

→ 입력 데이터가 바뀌면 sha256이 바뀌므로 보고서 결과의 재현 추적이 가능. session_id는 어떤 측정 회차의 결과인지 식별.

**대안 검토**
- raw PCM dump: 1시간 mono 16kHz f32 ≈ 115MB + 프라이버시 부담. 채택 X. spectrogram 해시로 cross-reference만.
- 단일 rotating 파일: 세션 경계를 파일 내 record로 표현. 분석 스크립트가 매번 session_id로 필터링하는 비용. 세션당 파일이 단순함 → 채택.
- 런타임 zod validation: 기존 IPC 정책과 동일하게 미적용 (타입만).

**향후 호환성**
- `v` 필드로 스키마 버전 명시. consumer는 unknown fields 무시. v=2 도입 시 추가 필드는 ignore-tolerant하게.
- 검출 모델 교체(openWakeWord 등) 시 `model.backend` 값을 새로 정의 (e.g. `"oww-onnx"`). 다른 필드는 그대로 재사용 가능.
