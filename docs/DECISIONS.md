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

> ℹ️ **갱신 이력 (2026-06-19)**: 한때 `hide()`/`show()`로 되돌렸다가, 작업표시줄 창
> 전환([D-019]) 과정에서 show/hide의 first-show 흰 깜빡임이 재현되어 **이 offscreen-park
> 방식을 다시 채택**했다. 단 작업표시줄 버튼과 양립시키려 `setSkipTaskbar`를 open/close에
> 맞춰 토글하고, 최소화는 네이티브 `minimize()`를 쓴다. 자세한 건 [D-019].

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

## D-013 — 단일 클라우드 두뇌(폰 연동) + 멀티테넌트 저장소

**일자**: 2026-06-14

**맥락**: 데스크톱 전용이던 비서를 폰(텔레그램)에서도, PC가 꺼져 있어도 쓰게 한다. 모든 두뇌(LLM 에이전트·툴)와 데이터(SQLite)가 PC 안 Core에 있어 PC가 꺼지면 동작 불가 → 클라우드에 Core를 띄워야 함.

**결정**:
1. **단일 클라우드 두뇌**: 동일한 `pa-core`를 Linux로 빌드해 클라우드에서 유일한 source of truth로 운영. 텔레그램 봇·데스크톱 모두 이 Core의 *클라이언트*. 에이전트/툴 로직 복제 금지. (대안: 클라우드에 TS로 두뇌 재구현 → 두뇌 분기·동기화 지옥, 기각.)
2. **멀티테넌트 격리 = 공유 Core + 전 테이블 `user_id`**. 최종 목표는 멀티테넌트 SaaS(확정). 클라우드 DB가 비어 있는 지금(Phase 6 배포 전) `user_id`를 도입해 retrofit 마이그레이션 부담을 0으로. (대안: DB-per-tenant → 1인 v0엔 과함, 기각.)
3. **쓰기 툴 실행을 Core로 이관**(기존: 렌더러 `toolExecutors.ts`가 클라이언트에서 실행). 승인 시 Core가 직접 실행 → 모든 클라이언트 thin, 매핑 중복 소멸. `chat.continue` 계약: `{tool_call_id, tool_name, approved}` (결과 대신 승인만).
4. **secrets 분리**: 플랫폼 전역(OpenAI 키·Google client id/secret)은 `SecretsStore`(키체인/파일, [D-003] 연장), 유저별 Google OAuth 토큰(refresh/access)은 per-user DB 행(암호화).
5. **호스팅**: Fly.io always-on(상태 보유 프로세스 + 스케줄러/싱크 루프, scale-to-zero 금지) + persistent volume(SQLite). 서버리스 기각.
6. **게이트웨이 노출 최소화**: 봇은 long-polling(아웃바운드만, 인바운드 0). WS 게이트웨이는 데스크톱 컷오버에만 필요하며 공개 포트 대신 Tailscale/WireGuard 사설 메시.

**v0에서 하지 않는 것(제품 검증 후 연기)**: 가입/로그인 UI, 호스티드 OAuth 웹 콜백, 결제/과금, 텔레그램 계정 링킹, 컨트롤 플레인. → v0는 저장소만 멀티테넌트 모양 + 토큰/매핑 수동 주입. v0 user_id 매핑: 데스크톱=고정 `user_id=1`, 텔레그램=chat-id.

**스키마 영향 (`0008_tenancy.sql`)**: `users` 신설, 기존 행 `user_id=1` 백필. 단순 칸 추가 = `todos`/`messages`/`memories`/`cost_ledger`. 복합키 전환 = `settings`(`key`→`(user_id,key)`), `sync_state`(`provider`→`(user_id,provider)`), `briefings`(`date`→`(user_id,date)`), `events`(`google_event_id`→`(user_id,google_event_id)`).

**리스크**: 쿼리 `user_id` 필터 누락 시 유저 간 데이터 누출(최우선 점검). 자연키 복합키 전환 누락 시 둘째 유저부터 충돌. → 4a(동작 불변, user_id 관통)와 4b(쓰기 실행 이관, 동작 변경)를 별도 커밋으로 분리해 리뷰.

## D-015 — 클라우드 KST 타임존

**일자**: 2026-06-15

**결정**: 클라우드 컨테이너에 `TZ=Asia/Seoul`(fly.toml env) + `tzdata`(Dockerfile). 미설정 시 Core의 `Local`이 UTC로 동작해 브리핑 날짜 경계·빈슬롯·알림·시각 표시가 9시간 어긋남. 멀티테넌트(B) 단계에선 유저별 tz로 대체. 데스크톱(로컬 모드)은 OS tz라 무관.

## D-014 — 데스크톱 Google 로그인 + 세션 JWT (범위 A)

**일자**: 2026-06-15

**맥락**: 데스크톱을 클라우드 Core의 클라이언트로 전환하되, env 토큰 수동 주입(임시방편)이 아니라 실제 "설치→로그인" 경험으로. 범위 A = 단일 오너(이메일 화이트리스트). 인증 아키텍처는 B(멀티유저)로 확장 가능하게.

**결정**:
1. **데스크톱이 Google 로그인을 직접 수행**(Main, TS) — 원격 모드는 로컬 core를 안 띄우므로 core의 OAuth를 못 씀. `openid email`만, 루프백 콜백 + PKCE + state/nonce(`apps/main/src/auth/google-login.ts`, oauth-shell 허용목록 재사용). 결과 = id_token.
2. **클라우드가 신원 검증 + 세션 발급**: `POST /auth/google`(게이트웨이 http 서버)에서 `google-auth-library`로 id_token 검증(서명/iss/aud/exp + `email_verified`) + `email==OWNER_EMAIL` → **HS256 세션 JWT**(`jose`, claims `user_id`/`sub`/`exp`30일, `iss:pa-gateway`/`aud:pa-desktop`) 발급. 서명 비밀 `PA_SESSION_SECRET`. 게이트웨이는 DB를 직접 안 만지므로 **무상태 JWT** 채택.
3. **게이트웨이 WS 인증을 세션 JWT로** 전환(`PA_GATEWAY_TOKEN` 전환기 병행). 1008 시 데스크톱은 재연결 말고 재로그인.
4. **세션 at-rest = Electron `safeStorage`**(OS 암호화). id_token·세션·secret 미로깅.
5. **패키징**: 빌드 설정(`cloud.config.ts`, 비밀 아님)으로 packaged=remote 기본, client id 박음. pa-core 미번들(`build:cloud`).

**범위 B 이음새**: `auth.ts mintSession`(이메일→실유저 매핑), `gateway.ts`(연결별 user_id를 RPC에 주입), `core-rpc supervisor.request`(엔벨로프 user_id 추가). per-user 호스티드 Google·결제는 서버측 신규.

**리스크**: 세션 secret 유출=전 세션 위조 → Fly 시크릿 전용·로테이션 시 전원 재로그인. 단일 오너라 `jti` 폐기목록 불필요(B에서 고려).

## D-016 — 캘린더 시간 충돌 확인 = 프롬프트 기반(결정론 검사 아님)

**일자**: 2026-06-15

**맥락**: 캘린더 추가/수정 시 항상 기존 일정과 시간이 겹치는지 확인하고, 겹치면 사용자에게 진행 여부를 물은 뒤 진행(거절 시 다른 시간 재질문)하고 싶음.

**결정**: Core에 결정론적 overlap 검사 + `allow_overlap` 플래그를 넣는 대신 **프롬프트 기반**으로 구현. `create_event`/`update_event`(시간 변경 시) 도구 설명 + `chat.rs` 시스템 프롬프트에 "호출 전 `list_today_events`/`list_upcoming_events`로 해당 시간대 겹침 확인 → 겹치면 무엇과 겹치는지 알리고 진행 여부 질문 → 거절 시 다른 시간 재질문" 규칙을 명시.

**이유**
- 기존 코드가 이미 "도구 호출 전 list로 먼저 확인"하는 프롬프트 유도 패턴을 씀(`update_event` 설명의 "먼저 list로 google_event_id 확인") → 같은 결로 일관.
- IPC 5계층/스키마 변경 0, write 도구의 이중 confirm UX(승인했는데 충돌로 막힘)를 회피.
- "겹쳐요, 그래도 할까요?"는 본질적으로 대화형 되묻기라 LLM 흐름에 자연스러움.

**같이 한 것**: 할 일 브리핑 포맷도 일정/스케줄과 동일한 결로 정리(`list_todos`용 `TODOS_PRESENT_HINT` 신설 + 브리핑 내 할 일 섹션 구조화: 기한순·예상시간·우선순위 ★). 표시 지침은 system 프롬프트가 아니라 **해당 도구 결과에 동봉**되는 기존 패턴([D-012] 아님, `PRESENT_HINTS`) 재사용이라 일상 대화에 누적·간섭 없음.

**트레이드오프**: LLM 준수에 의존 → "항상"의 100% 보장은 아님(라이브에선 의도대로 동작 확인). 확실한 보장이 필요해지면 후속으로 Core에 결정론적 overlap 검사 + `allow_overlap` 플래그 도입(단 IPC 5계층 + 이중 confirm 비용).

**적용 범위**: 변경이 전부 `pa-core`(프롬프트/문자열)라 데스크톱·텔레그램 봇이 자동 공유. 마이그레이션·스키마 변경 없음.

## D-017 — main 푸시 시 Fly 자동 배포(CI/CD)

**일자**: 2026-06-15

**결정**: `main` 푸시 시 GitHub Actions가 `flyctl deploy --remote-only`를 자동 실행(`.github/workflows/deploy.yml`). 인증은 레포 시크릿 `FLY_API_TOKEN`(app 스코프 deploy 토큰).

**이유**: Core/봇 변경이 클라우드에 반영되려면 `fly deploy`가 필요한데 수동 실행 누락을 방지. `--remote-only`라 러너에 Docker 셋업 불필요(Fly 원격 빌더가 멀티스테이지 Dockerfile = Rust `pa-core` + cloud-bot 빌드).

**세부**
- 문서만(`**.md`, `docs/**`) 바뀐 푸시는 배포 스킵(Rust 풀빌드가 무겁고 worklog 커밋이 잦음). 코드와 섞인 푸시는 정상 배포(paths-ignore는 변경 전부가 매칭될 때만 스킵).
- `concurrency: cancel-in-progress` — 새 푸시 시 진행 중 배포 취소(최신 우선, 단일 머신이라 안전).
- `workflow_dispatch`로 Actions 탭에서 수동 배포도 가능.

**트레이드오프**: 코드 푸시마다 프로덕션이 자동 배포됨 → 검증 안 된 변경도 즉시 라이브(단일 오너 v0라 수용). 보호가 필요해지면 GitHub Environment 승인 게이트를 후속 추가.

**보안**: deploy 토큰은 app 스코프. 셋업 디버깅 중 채팅에 노출된 옛 토큰은 `fly tokens revoke`로 폐기 완료, 현재 시크릿은 클립보드 경유로 재발급한 별도 토큰.

## D-018 — 일정 장소 명시 + 이동시간 사전 알림 (v1 구현)

**일자**: 2026-06-16 설계 / 2026-06-17 v1 구현 착수

**상태**: **v1(이동시간 출발 알림) 구현됨** (`feat/travel-eta`). 아래 미해결 3건 확정:
- **대중교통 경로 = ODsay 단독**(무료 1000건/일). 자동차/도보는 v1 제외(향후 `travel.mode` 확장 여지).
- **지오코딩 = Kakao Local API**(키워드 검색). ODsay는 좌표 기반이라 텍스트→좌표는 Kakao가 담당.
- **모호 장소 = `place_alias` 테이블**(user_id 스코프). "집"은 `travel.home` 설정으로 별도.

**구현 메모(2026-06-17)**:
- 마이그레이션 0009: `place_alias`(테넌트) + `geocode_cache`·`route_cache`(전역, 비용 절감).
- 서비스 `core/src/services/travel/`(geocode/route/pure). 순수 로직(출발지 추론·캐시키·버킷)은 cargo test.
- 알림: `notifications/mod.rs`에 `kind="leave"` 경로 추가. 3시간 윈도우 + `notifications_sent` 디듑 +
  route_cache(30분 버킷·7일 TTL)로 외부 호출 최소화. `depart_by` 도달 시 1회 발화.
- 설정: `notifications.leave_enabled`/`travel.mode`/`travel.buffer_min`/`travel.home`. IPC: `travel.alias*`/`travel.today`.
- 채팅 도구 `list_today_travel`(read-only) 추가. 출발지 추론: 직전 일정 장소, 간극 4h 초과/무장소면 집.
- **degrade 원칙**: 지오코딩/경로 실패·키 미설정·home 미설정 시 조용히 skip(거짓 출발 알림 < 미발화).

**맥락**: "비서가 미리 챙겨준다"의 연장 — 일정에 장소를 항상 남기고, 연속 일정 사이 이동을 고려해 "언제·어떻게 나가야 하는지"를 사전에 알려주고 싶음. 기능은 난이도가 다른 두 조각으로 분리된다.

**결정(방향)**
1. **두 조각으로 분리해 단계화한다.**
   - **(A) 장소 명시** — `events.location`은 이미 존재(free text, optional). `create_event` 도구/시스템 프롬프트에서 장소를 받도록 *권장(soft)*. **강제(hard) 아님** — 전화/온라인 일정은 장소가 없으므로 "온라인/장소없음"을 명시적으로 받는 길을 둔다.
   - **(B) 이동시간 알림** — 지오코딩 + 연속 일정 쌍의 이동시간 + "출발 시각" 계산 + 사전 알림.
2. **단계 분리**:
   - **v0 (외부 API 없이 가치검증)**: 장소 명시 권장 + 연속 일정의 장소 텍스트가 *다르면* 브리핑/알림에 "이동 있음, 여유 두세요" 휴리스틱 경고. 거리/시간 계산 없음. 저비용·빠른 검증.
   - **v1 (실측)**: 라우팅 API로 실제 이동시간 → "○시 ○분에 나가세요(수단 N분)" 출발 알림.
3. **알림은 기존 스케줄러 재사용**: `notifications/mod.rs`의 분당 틱 루프에 고정 1h/15m 외에 **`kind="leave"`를 추가**하고, 리드타임을 고정값이 아니라 *계산된 이동시간 + 버퍼*로 둔다. 현재 select는 단일 이벤트만 보므로 **연속 일정 쌍**을 보도록 확장 필요. `notifications_sent` 디듑·DND·TTS·설정 토글은 그대로 재사용.
4. **이동 데이터 소스 = Naver Cloud Platform(NCP) 기본 방향** (Directions + Geocoding). 단 **NCP Directions는 자동차 경로 위주** — 대중교통 경로/시간이 필요하면 ODsay 등 보완이 추가로 필요(아래 미해결).
5. **출발지 추론**: 첫 일정의 origin이 모호 → `travel.home`(기본 출발지) 설정 신설. 일정 사이는 직전 일정 장소가 origin.

**대안 검토**
- 지도 API: **Google Directions 기각** — 한국 내 자동차 길찾기를 사실상 제공 안 함(국내 지도데이터 국외반출 규제). 한국 중심 앱엔 부적합. Kakao Mobility(자동차 강·무료쿼터 넉넉), TMap+ODsay(수단 풀커버지만 통합 2개) 검토 후 **Naver/NCP 선택**(님 선택; 안정성·지오코딩 일체형). 비용 관리가 트레이드오프.
- 충돌 알림을 결정론으로 갈지: [D-016]과 동일한 고민 — 우선 프롬프트/휴리스틱(v0)으로 가치부터 검증.
- DB-레벨 좌표 강제 vs 캐시: 좌표는 지오코딩 결과 캐시로(자유텍스트 그대로 유지).

**트레이드오프 / 리스크**
- **BM 비용**: per-use 외부 API 비용이 하나 더 추가됨([project_bm_direction]의 "비용 자체 부담" 정책에 직접 영향). NCP는 무료티어가 작아 **(출발지·도착지·수단·시간대) 캐싱이 필수**.
- v1은 **큰 작업** — 마이그레이션(좌표 캐시, `kind="leave"`) + 새 서비스 `services/travel/`(geocode+routing, `calendar/google.rs` 패턴, API키는 secrets) + notifications 구조 변경 + 설정 신설(`travel.mode`/`travel.home`/buffer/`notifications.leave_enabled`) + 브리핑 표시. → `feat/travel-eta` 브랜치 + PR 권장([CLAUDE.md] 브랜치 전략).
- LLM 준수 의존(장소 명시 권장)은 [D-016]처럼 100% 보장 아님.

**미해결(다음 세션 착수 전 정할 것)**
- **대중교통 경로**: NCP가 자동차 위주라, 대중교통 수단/시간을 줄지(ODsay 병행) 아니면 v1은 자동차/도보만 다룰지.
- 지오코딩 실패/모호 장소("회사")의 처리 — 별칭→좌표 사용자 등록 vs 매번 질문.
- 적용 범위: 변경 대부분이 `pa-core`라 데스크톱·텔레그램 봇 자동 공유 예상(확정은 착수 시).

---

## D-019 — 아바타=순수 위젯(작업표시줄 제외), 패널=진짜 창(작업표시줄 포함)

**일자**: 2026-06-19

**결정**: 두 BrowserWindow의 작업표시줄 성격을 반대로 둔다.
- **아바타** `skipTaskbar: true` — 작업표시줄을 점유하지 않는 순수 위젯(항상 위, 트레이로 표시/숨김).
- **패널** `skipTaskbar: false` + `title` 지정 — 일반 창처럼 작업표시줄 버튼 노출, 헤더에 **최소화(─)·닫기(✕)** 버튼 추가.
  - 최소화 = `window.minimize`(신설 IPC, Main 자체 처리) → 작업표시줄에 버튼 유지, 네이티브 restore.
  - 닫기 = 기존 `window.setPanelOpen(false)`(hide) → 작업표시줄에서 빠지고 트레이 "패널 열기"로 재소환.

**이유**
- 사용자 피드백: 아바타는 위젯다워야(작업표시줄에 안 떠야) 하고, 패널은 창처럼 최소화/복원이 편함.
- 외형은 유지: frameless·transparent 둥근 카드를 그대로 두고 커스텀 버튼만 추가(네이티브 프레임 미채택). 둥근 모서리·그림자 보존.

**대안 검토**
- OS 네이티브 프레임(`frame:true`): 최소화/스냅 무료지만 둥근 카드 미감 상실 → 기각.
- 트레이만으로 재소환 강화: 이미 트레이 "패널 열기"가 있으나, 작업표시줄 최소화 손맛을 원함 → 패널 창화 채택.

**리스크 / 비고**
- [D-005]의 transparent+frameless 첫-show flicker는 **실사용에서 재현됨** — show/hide로 토글하면 등장 시 흰 깜빡임이 보였다. 그래서 **offscreen-park를 다시 채택**(닫기=화면 밖 park + `setSkipTaskbar(true)`, 열기=onscreen 이동 + `setSkipTaskbar(false)`, show/hide 호출 없음). 최소화만 네이티브 `minimize()`. minimize→restore의 깜빡임 여부는 실사용 확인 필요.
- 상단 드래그: `.panel-card`를 ring으로 바꿔 헤더를 y=0에 붙였는데도 일부 DPI/창 상태에서 맨 윗줄이 안 잡혀, PanelApp 최상단에 명시적 drag 스트립(6px)을 추가해 보장.
- IPC 계약 변경(`window.minimize` 신설): methods.ts·preload.ts·ipc.ts·renderer api.ts 동기화. Window 도메인이라 core forward·zod 없음.
- 브랜치: `feat/panel-taskbar-window`.
