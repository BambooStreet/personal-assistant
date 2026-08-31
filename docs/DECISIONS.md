# Decision Log

큰 의사결정과 그 이유를 기록한다. "왜 그렇게 했지" 자문 시 빠른 참조용.

> **범위 (2026-06-19~)**: 여기엔 **교차-관심(cross-cutting) 결정만** 쌓는다 — 한 도메인이 소유하지
> 못하는 아키텍처 전반. 도메인 고유 결정은 도메인 문서(`docs/<domain>/`)에. 기존 윈도잉 결정
> (D-004·005·006·007·019)은 `docs/UI/windowing.md`로 이관되어, 아래엔 포인터만 남긴다(D-번호는
> 코드 주석 앵커라 유지).

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

**일자**: 2026-05 · 📍 **UI 이관** — 현재 동작·불변식은 `docs/UI/windowing.md`.

**결정**: 아바타 + 패널을 별도 BrowserWindow로 분리(단일 창 리사이즈 시 아바타 점프 회귀 회피).

---

## D-005 — panelWindow는 hide가 아닌 offscreen-park

**일자**: 2026-05-03 · 📍 **UI 이관** — 현재 동작·불변식은 `docs/UI/windowing.md`.

**결정**: 패널 닫기 = `hide()` 대신 화면 밖 park(`-20000`). transparent/둥근 opaque 창의 show·hide
전환 깜빡임 회피. (한때 hide/show로 되돌렸다 [D-019] 과정에서 재채택.)

---

## D-006 — 4분면 자동 회전 로직 제거

**일자**: 2026-05-03 · 📍 **UI 이관** — 현재 동작·불변식은 `docs/UI/windowing.md`.

**결정**: 패널 위치를 모니터 4분면에 따라 자동 회전하던 로직 제거. 패널은 항상 아바타 위로 단순 등장.

---

## D-007 — Hit-region 대신 setIgnoreMouseEvents 사용

**일자**: 2026-05 · 📍 **UI 이관** — 현재 동작·불변식은 `docs/UI/windowing.md`.

**결정**: 투명 영역 클릭 통과 = Win32 hit-region 대신 `setIgnoreMouseEvents(true,{forward})` +
Renderer 호버 추적(`data-clickable`). 크로스플랫폼, native FFI 불필요.

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

**일자**: 2026-06-19 · 📍 **UI 이관** — 현재 동작·불변식은 `docs/UI/windowing.md`.

**결정**: 아바타 `skipTaskbar:true`(순수 위젯) / 패널은 작업표시줄 창화(헤더 최소화 ─·닫기 ✕, 신설
IPC `window.minimize`). 이후 패널을 **불투명 전환**(깜빡임 원천 차단) + 등장 애니메이션 제거까지
진행 — 최종형은 `docs/UI/windowing.md` 1~3절. 브랜치 `feat/panel-taskbar-window`.

---

## D-020 — 라이트/다크 테마 = 시맨틱 CSS 변수 토큰 + Core 설정 저장

**일자**: 2026-08-08 · 브랜치 `feat/theme-light-dark` · worklog `2026-08-08`.

**맥락**: 다크 전용 UI에 라이트 모드를 추가. 화면마다 화이트 버전을 손으로 만들면 중복·불일치.

**결정**
1. **색 = 시맨틱 토큰(CSS 변수 RGB 채널)**. Tailwind 색을 `rgb(var(--x) / <alpha-value>)`로 정의
   (`--bg`/`--bg-panel`/`--bg-elevated`/`--fg`/`--fg-muted`/`--fg-subtle`/`--accent`). 값은
   `globals.css`의 `:root`(다크)/`.light`가 스왑 → **컴포넌트는 안 건드리고 팔레트만 바꾸면 전 화면 반영.**
2. **기본 = 다크(클래스 없음)**, `<html>.light`가 붙으면 라이트. → 기존 다크 룩 **무회귀**.
3. **테마 저장 = Core 설정**(SQLite). 기존 범용 `settings.get/set` + allowlist에 `ui.theme` 키 한 줄만
   추가 — **새 IPC 메서드 없음**(4곳 확장 불필요). 상태=`useUserSettingsStore.theme`, 창 간은
   `ui.themeChanged` broadcast로 동기화(`useTheme.ts`).
4. **테두리 토큰 이원화**: `--line`(실선 카드/구분선, 불투명) vs `--hairline`(스크롤바 등 저불투명
   오버레이 채널, 다크=흰색·라이트=어두움). 하나로 겸하면 스크롤바가 라이트/다크 중 한쪽서 안 보임.
5. **팔레트 값 출처 = Claude 디자인**(채팅 리디자인 export, 인디고 accent). 프리미티브는 1단계에서
   "순수 리스타일"만(채팅 버블·입력창). 핸드오프 절차는 `docs/design/THEME-HANDOFF-KIT.md`.

**트레이드오프 / 후속**
- 다른 화면의 `border-white/x` 흰색 오버레이는 라이트에서 흐릿 → `border-line`로 순차 정리 필요.
- 테마 저장이 현재 단일 유저 전제 — per-user는 [project_cloud_brain_tenancy]의 테넌시 작업과 함께.
- 2단계(인챗 일정/할일 카드·메시지 액션·빠른답장·아바타 칩)는 새 기능이라 데이터 배선 후 별도 진행.

---

## D-021 — 목표(goals) + 루틴 알림: 스케줄러 형제 함수 + DND 예외 + 요일 비트마스크

**일자**: 2026-08-20 (`feat/goals`)

**맥락**: `2dd809d`로 아침 브리핑을 "오늘의 한마디"로 바꿨는데, 그 프롬프트는 *"목표에 한 걸음
다가가도록"*을 지시하면서 정작 **목표 데이터가 DB에 없어** 마감 임박한 할 일을 목표인 척 짚고
있었다. 사용자가 장기 목표와 그 '왜'를 등록해 두면 스스로 정한 시각에 그 '왜'를 담은 알림을
받게 한다. 기능은 3개(목표·루틴·알림)로 **의도적으로 작게** 잘랐다 — 매일 오는 알림이 실제로
먹히는지부터 검증한다.

**결정**

1. **루틴 발화는 `notifications::tick()`의 형제 함수**(`goals::routines_tick`). `tick()`은 DND면
   함수 전체를 early return 하므로 그 안에 넣으면 DND 기본값(22:00~08:00)이 밤 루틴을 통째로
   삼킨다. `tick()`을 리팩터링해 분기마다 가드를 뿌리는 대신 형제로 분리 — 잘 돌던 코드를 안
   건드리고, "일정 알림(앱이 판단)"과 "루틴 알림(사용자가 정함)"이라는 성격이 다른 두 개념도
   섞이지 않는다. `run_scheduler_loop`에 3줄만 추가(유저 순회·60초 틱을 그대로 재사용).
2. **루틴 알림은 DND를 통과한다.** 사용자가 직접 정한 시각이라 앱이 자동 판단하는 일정 알림과
   성격이 다르다. 단 **마스터 스위치 `notifications.enabled`는 존중**한다 — "알림 전부 끄기"를
   눌렀는데 루틴만 울리면 그게 버그다. **새 설정 키는 추가하지 않았다**(allowlist 무변경).
3. **요일 = 비트마스크 INTEGER, bit0=월 … bit6=일, 매일=127.** chrono
   `Weekday::num_days_from_monday()`와 정확히 일치해 변환 코드가 0이고, SQL에서
   `(days_mask & ?) != 0`로 오늘치만 걸러 온다. 별도 `freq` 컬럼을 두지 않아 "freq=daily인데
   days도 채워짐" 같은 모순이 구조적으로 불가능.
   - ⚠️ **규약 충돌 주의**: `renderer/components/todos/DateField.tsx`의 달력은 **0=일** 기준이다.
     요일 UI는 반드시 `settings/LifestyleSection.tsx`(0=월)를 따를 것. 하루 밀리면 알림이 통째로
     어긋나므로 `services/goals/pure.rs`의 `today_bit` 테스트로 잠가 뒀다.
4. **루틴 알림은 `routine.fired` 신설**(기존 `notification.fired` 재사용 X). 그 payload는
   `event_id`(캘린더 PK)를 전제하고 `PanelApp`에 TTS 문구 조립 삼항 사슬이 붙어 있는데, 루틴은
   LLM이 완성 문구를 이미 만들어 오므로 그 로직이 통째로 낭비다.
5. **문구 실패 시 폴백으로 반드시 발화** — [D-018]의 degrade 원칙과 방향이 **반대인 게 의도적**.
   이동 알림은 "거짓 발화 < 미발화"지만, 루틴 알림은 "밋밋한 문구 > 미발화"다. 사용자가 스스로
   정한 시각인데 아무것도 안 뜨면 루틴 자체를 놓친다. payload의 `generated: bool`로 사후 판정.
6. **아침 브리핑 줄은 `BriefingPayload.goal_lines`**(Core 생성, LLM 아님). 렌더러에서 그리지 않은
   이유: PanelApp/AvatarApp이 **별도 React 트리라 스토어 인스턴스가 분리**되고 BriefingCard는
   채팅 탭인데 목표 섹션은 다른 탭이라(당시 개인 탭, 지금은 목표 탭) 로딩 타이밍에 깜빡인다. **`briefings` 캐시에는 저장하지
   않고 반환 지점마다 재계산** — 아침에 목표를 추가한 게 즉시 반영되고 스키마 변경도 없다.
7. **지각 발화 상한 60분**(`ROUTINE_GRACE_MIN`). 하한은 60초 틱 드리프트 때문에 정각 매칭이
   불가능해서, 상한은 3시간 지난 "10시에 하기로 했어요"가 소음이라서. 22:00 루틴을 22:30에 켜면
   뜨고 23:10에 켜면 안 뜬다.
8. **디듑은 `(routine_id, date)` 새 테이블.** 기존 `notifications_sent`는 PK가 `(event_id, kind)`에
   user_id도 없어 매일 반복되는 루틴을 담을 수 없다. `date`는 **로컬** 기준(UTC면 KST 09:00 이전
   루틴이 전날로 기록됨). **클레임(INSERT OR IGNORE) 먼저, 문구 생성은 그 다음** — LLM 때문에
   1~3초 공백이 생겨 "확인 후 기록" 2단계는 중복 발화 위험.

**후속 결정(같은 날)**: 루틴 알림 문구를 **`messages`에 저장한다**(처음엔 안 넣었음).
근거는 사용자 판단 — LLM 컨텍스트 오염은 나중에 RAG/컨텍스트 선별로 풀 문제이지, 지금 기록을
안 남길 이유는 아니다. 대신 `messages.source` 컬럼을 함께 신설(0011)해 `'routine_nudge'` /
`'briefing'` / `null`(실제 대화)을 구분한다 — 태그 없이 쌓으면 나중에 되돌려 분리할 방법이
없기 때문. 화면에는 발화 즉시 `appendAssistantText`로 반영하고, 재시작 후엔 DB에서 복원된다.

**의도적으로 만들지 않은 것** (재도입 전에 이 항목을 먼저 볼 것): 진척률·달성률 %, 스트릭
(깨지면 이탈을 부른다), 목표 대시보드(들어가야 보이는 화면은 2주 뒤 안 들어간다), 마일스톤,
주간 회고, 적응 루프, 텔레그램 연동, 알림의 "했어요" 버튼(완료 추적 일절 없음).

**채팅 도구도 1차 제외.** 목표는 평생 3~5개 만드는 물건이라 UI 폼이 더 빠르다. 게다가
`create_todo`가 이미 `recur:"daily"`를 지원해서 "매일 밤 10시 영어"라고 말하면 LLM이 goal이 아니라
**반복 todo를 만들 확률이 높다** — 두 개념의 경계를 프롬프트로 긋는 별도 작업이 선행돼야 한다.

**트레이드오프 / 후속**
- `get_bool_setting` 사본이 4번째가 됐다(notifications·schedule·travel·goals). 공용 헬퍼 추출은
  별도 리팩터링 이슈.
- 루틴 알림은 데스크톱 앱이 켜져 있어야 뜬다. 밤 루틴이 이 한계에 가장 많이 걸리는데, 텔레그램
  폴백은 1차에서 보류했다.
- `routine_notifications_sent`는 프루닝하지 않는다(루틴 5개/일 = 연 ~1,800행 ≈ 50KB).


---

## D-022 — 하루 첫 인사는 Core 브리핑 LLM이 시간대 맥락으로 생성

**일자**: 2026-08-25

**맥락**: 그날 처음 앱을 켜면 아바타가 **"네, ○○님" → 브리핑 요약** 순으로 말했다. 앞의 인사는
[D-010]의 wake 응답 캐시를 그대로 재사용한 것인데, 그건 *부름에 대한 대답*이라 부팅 맥락에선
말이 안 됐다. 브리핑 본문도 시각을 몰라서 밤 11시에 처음 켜도 "하루를 여는 한마디"가 나왔다.

**결정**: 인사를 렌더러에서 떼어내 **Core 브리핑 텍스트 안으로 옮긴다**. `generate_summary`에
현재 시각·`TimeSlot`(새벽/아침/점심/오후/저녁/밤)·`user.name`을 넘기고, 슬롯별 `framing()`이
"하루를 여는 결인가, 정리하는 결인가"를 지시한다. 렌더러 부팅 시퀀스는 브리핑 TTS 한 번만 재생.

**이유**
- 인사와 본문이 **같은 시각 맥락을 공유**한다. 렌더러가 앞에 문구를 붙이는 구조로는 둘의 톤이
  따로 놀 수밖에 없다(밤에 "네, ○○님" + 아침 브리핑).
- 부팅 시 TTS 호출이 2회 → 1회. `speakSequence`의 `greetingAudio`는 optional이라 계약 변경 없음.
- IPC 5계층·스키마·마이그레이션 변경 0. 프롬프트와 호출부만 바뀐다.

**[D-010]과의 관계**: 폐기 아님. **wake 사이클의 "네, ○○님"은 그대로**다 — 부름엔 대답이 맞다.
부팅 경로에서만 쓰지 않는다.

**알고 넘어갈 것**: 브리핑은 `(user_id, date)`로 하루 한 번만 생성되므로 인사 톤은 *그날 처음
켠 시각*으로 굳는다. 저녁에 카드를 다시 봐도 아침 인사가 남는다 — 자동 재생은 생성 직후 1회뿐이라
**들을 때는 항상 맞는 톤**이고, 카드의 "다시 생성"(force)을 누르면 그 시각으로 새로 만들어진다.

**같이 한 것**: 프롬프트의 일정 줄에 `(이미 지남)` 표시 추가. 쿼리가 하루 전체를 보기 때문에
오후에 켜면 끝난 일정이 그대로 들어와 "이따 ○○ 있어요"로 둔갑했다. temperature 0.5 → 0.7
(인사가 매일 같은 문장이면 벽지가 된다 — [D-021] 루틴 알림 0.8과 같은 이유).

---

## D-023 — 채팅 턴 계측: 무엇을 남기고 무엇을 남기지 않는가

**일자**: 2026-08-25

**맥락**: 데스크톱에서 "할 일 목록"을 쳤는데 아무 응답도 안 보인 사건. 조사해 보니 **서버는
23초 만에 정상 응답을 만들어 DB에 저장**했고, 화면에만 안 나타났다. 원인 파악에 클라우드
`messages` 테이블을 직접 조회해야 했다 — `fly logs`에도 `/data/logs/core.log`에도 채팅은
**한 줄도 안 찍히기 때문**(배경 캘린더 동기화와 알림만 있었다). 원격 모드라 데스크톱 쪽
로그는 아예 0이라, 그 23초 동안 클라이언트에서 무슨 일이 있었는지는 끝내 복원하지 못했다.

**결정**: `run_agent_loop`를 계측한다. 네 지점 — `chat turn start`, `chat llm call`(iteration별),
`chat tool executed`, `chat turn end`. 소요 시간(ms)·토큰·비용·finish_reason·도구 이름을 남긴다.

**남기지 않는 것 (의도적)**: 사용자 발화와 응답 **본문**, 그리고 **도구 인자**. 본문은 길이
(`text_chars`)만, 도구 결과는 크기(`result_bytes`)만 남긴다. 일정 제목·주소·할 일 내용이
전부 개인정보다. 로그는 Fly 볼륨에 무기한 쌓이므로(7월분부터 남아 있다) 본문을 넣으면
지우기 어려운 개인정보 저장소가 된다.

**텍스트도 pending 도구도 없이 끝난 턴은 WARN**. 렌더러의 `finalizeTurn`이 그 경우 말풍선을
삭제하므로(`useChatStore.ts`), **화면에 아무것도 안 남는 유일한 경로**다. INFO에 묻히면 안 된다.

**왜 LangSmith가 아닌가**: trace 코드(`infra/telemetry.rs`)는 이미 있지만 `langsmith` feature가
꺼진 채 빌드되고(Dockerfile) 키도 없다. 켜면 프롬프트 전문이 외부로 나가므로 위 프라이버시
결정과 정면으로 충돌한다. 상시 계측은 로컬 로그, LangSmith는 필요할 때만 켜는 도구로 둔다.

**후속 (같은 날 처리됨)**
- **데스크톱 파일 로그** — `userData/logs/main.log.YYYY-MM-DD`(14일 보존). WS 연결/끊김/재연결과
  RPC 요청·응답을 같은 id로 짝지어 소요시간과 함께 남긴다. 토큰과 `params`는 제외 — 같은
  프라이버시 기준이다. 트레이 → "로그 폴더 열기"로 사용자가 바로 찾는다.
- **채팅 진행 표시** — Core가 `chat.progress` 이벤트를 단계마다 쏘고(`thinking` / `tool`+도구
  이름) 렌더러가 "할 일 찾아보는 중…"으로 바꾼다. 게이트웨이가 모든 Core 이벤트를 WS로
  팬아웃하므로 원격 모드에서도 그대로 동작한다.
  - **`sending`일 때만 표시한다**: 클라우드 Core는 텔레그램 턴에도 같은 이벤트를 쏜다. 내가
    보낸 턴이 아닌데 "찾아보는 중"이 뜨면 거짓말이 된다.
  - 모르는 `phase`는 문구를 띄우지 않는다 — 구·신 버전이 섞여도 엉뚱한 말이 뜨지 않게.

**아직 남은 구멍**: 텍스트도 카드도 없는 턴에서 렌더러가 말풍선을 **삭제**하는 경로는 그대로다
(`useChatStore.ts`의 `finalizeTurn`). 실패와 침묵이 화면에서 구분되지 않는다는 뜻이라,
`useChatStore.test.ts`에 현재 동작을 못 박는 테스트를 두어 드러내 놓았다. 고칠지는 별도 판단.

---

## D-024 — LLM 호출을 trait seam으로: agent loop을 네트워크 없이 검증

**일자**: 2026-08-25

**맥락**: [D-023]의 사건을 조사하며 드러난 것 — `run_agent_loop`은 이 앱에서 가장 분기가 많은
코드(도구 prefix 자르기, 읽기 자동 실행, 쓰기 confirm 반환, orphan 정리, max iteration 폴백)인데
**테스트가 0개**였다. `openai.rs`의 `ENDPOINT`가 상수라 LLM을 갈아끼울 구멍이 없었기 때문이다.
`testing.rs`의 `test_state()` 하네스는 이미 있었지만 채팅만 그 혜택을 못 받았다.

**결정**: `LlmClient` trait(`services/llm/mod.rs`)을 두고 `AppState.llm: Arc<dyn LlmClient>`로
주입한다. 프로덕션은 `OpenAiAdapter`, 테스트는 `FakeLlm`(대본대로 응답 + 받은 요청 보관).

**왜 HTTP 목이 아닌가**: 엔드포인트만 env로 빼고 로컬 목 서버를 띄우는 방법도 있었다. 하지만
검증하려는 건 HTTP가 아니라 **응답 시퀀스에 따른 루프의 분기**다(1턴은 tool_call, 2턴은 텍스트).
trait 가짜는 그 대본을 그대로 쓰지만 목 서버는 요청 매칭 규칙을 따로 짜야 하고, 포트·타이밍
때문에 느리고 불안정하다. 새 dev-dependency도 필요 없다.

**같이 얻은 것**: `FakeLlm`이 받은 요청을 보관하므로 **프롬프트에 무엇이 실렸는지**도 검증한다.
표시 지침(`PRESENT_HINTS`)이 도구 실행 직후 iteration에만 붙는지, orphan tool_call이 짝을 갖고
닫혔는지 — 둘 다 실제로 깨진 적 있는 지점인데 이제 테스트가 지킨다(8개 추가, core 총 100개).

**한계 (알고 쓸 것)**: 이 하네스는 **Core 안쪽만** 본다. 이번 사건의 진짜 실패 지점이었던
"응답은 왔는데 화면에 안 뜬다"는 여기서 못 잡는다 — 그건 렌더러 하네스의 몫이다.
`briefing`·`goals/notify`도 같은 seam을 쓰므로 이제 가짜를 꽂을 수 있지만, 아직 안 썼다.

---

## D-025 — 부팅 인사와 모닝 브리핑 분리

**일자**: 2026-08-30

**맥락**: [D-022]는 인사를 브리핑 프롬프트 안으로 넣었다. 당시엔 옳았다 — 둘 다 "그날 처음 켤 때
한 번"이라 주기가 같았으니 한 덩어리가 자연스러웠다. 그런데 실제로 써 보니 두 가지가 걸렸다.
① 하루에 컴퓨터를 여러 번 켜도 인사는 첫 실행 때 한 번뿐이라 두 번째부터는 앱이 벙어리였다.
② 인사에 늘 "지금 이걸 하세요"가 따라붙었다 — **인사만 받고 싶은데 매번 훈수를 듣는 셈**이라
오히려 거슬렸다.

**결정**: 인사와 브리핑을 **주기가 다른 두 가지**로 나눈다.

| | 인사 (`services/greeting`) | 모닝 브리핑 (`services/briefing`) |
|---|---|---|
| 트리거 | 앱 프로세스 시작 | 인사와 같되 아침 창 안일 때만 |
| 빈도 | 쿨다운 3시간 | 하루 한 번(`(user_id, date)` 캐시 그대로) |
| 내용 | **인사만**. 할 일·일정 언급 없음 | 오늘 짚을 것 하나 |
| 표시 | 채팅 말풍선 | 브리핑 카드 |

부팅은 `greeting.run` 호출 하나로 끝난다 — 응답에 브리핑을 동봉해서 창 판정 정책이 렌더러로
새지 않게 했다. 창 시각은 설정(`briefing.window_start`/`_end`, 기본 05:00~13:00)에서 바꾼다.

**"인사는 인사만"을 지키는 법**: 일정·할 일을 프롬프트에 **아예 싣지 않는다**. 실으면 LLM이
반드시 짚는다(브리핑 프롬프트가 그 증거). 폴백 문구 풀도 같은 규칙이고, 테스트가 그걸 못박는다
(`할 일`/`일정`/`마감` 문자열 금지).

**재회 간격은 캘린더 일수로 가른다**: "오랜만이에요"인지 "또 봐요"인지를 경과 시간으로 판정하면
20시간이 같은 날일 수도 이틀 밤을 걸칠 수도 있다. 사람이 체감하는 "며칠 만"은 후자라
`classify_gap`은 로컬 날짜 차이만 본다. 기준선은 **마지막 인사와 마지막 사용자 발화 중 나중 것** —
인사 시각만 보면 앱을 며칠 켜 둔 채 매일 대화한 사람이 재부팅할 때 "3일 만이네요"가 나온다.

**쿨다운 3시간**: 하한은 크래시·재부팅에 연달아 인사하지 않게, 상한은 아침·점심·저녁에 각각
인사할 수 있게. 트레이에서 창을 여닫는 건 트리거가 아니다(프로세스가 살아 있으므로 호출 자체가
없다).

**마이그레이션 없음**: 쿨다운 기준선은 `settings`의 `greeting.last_greeted_at` 한 줄이고,
**allowlist에 넣지 않았다** — UI가 쿨다운을 리셋할 수 있으면 안 된다(`daily_cost_cap_usd`와
같은 취급). 되돌리기는 코드 revert 하나면 되고, 남는 설정 행은 무해한 고아 키다.

**인사 한 번을 보장하는 법**: 쿨다운 갱신을 조건부 upsert로 하고 `rows_affected()`로 승자를
가린다([D-021]의 `routine_notifications_sent` 클레임과 같은 결). 아바타/패널 두 창이 동시에
부팅하거나 렌더러 가드가 HMR로 뚫려도 여기서 잡힌다. 그 위에 역할 분리를 얹었다 —
**호출과 TTS는 AvatarApp만, 말풍선은 PanelApp만**. `useBriefingStore`의
`pendingAutoPlay`/`consumeAutoPlay`는 제거했다. 두 React 트리에 스토어 인스턴스가 갈라져 있어
one-shot 플래그가 창마다 따로 존재하는 게 애초에 중복의 원인이었다.

**인사는 LLM 컨텍스트에 최근 1건만**: 전부 빼면 "오늘 뭐 할 거예요?"에 사용자가 답했을 때 모델이
자기 질문을 못 봐서 대화가 끊긴다. 전부 넣으면 `HISTORY_TURN_CAP`(40)이 인사로 도배된다.
`load_recent_messages`가 `source='greeting'` 중 가장 최근 것만 남긴다. 화면용 `chat_history`는
필터하지 않는다 — 지난 인사도 스크롤하면 보여야 한다.

**[D-022]와의 관계**: **부분 폐기**. 인사를 브리핑 프롬프트에서 다시 떼어내고
`TimeSlot::framing()`도 지웠다(브리핑이 아침 전용이면 나머지 슬롯 분기는 죽은 코드다).
살아남은 것: `TimeSlot`/`label()` 자체는 인사가 쓴다(아침이면 "오늘 뭐 할 거예요?", 저녁이면
"오늘 뭐 했어요?"), `(이미 지남)` 표시, 높은 temperature.
**[D-010]은 유지** — wake의 "네, ○○님"은 부름에 대한 대답이라 그대로다. 다만 부팅 인사의
`speakSequence` phase는 `attentive` → `speaking`으로 바꿨다. 귀 기울이는 자세가 아니라
먼저 말을 거는 것이므로.

**[D-024]의 남은 구멍 하나 메움**: `testing.rs`에 `test_state_with_llm_and_key`를 추가했다.
기존 `EmptySecrets`는 키에 항상 `None`을 줘서 "키 없으면 폴백" 분기만 밟혔고 LLM 경로를 아예
못 탔다. 이제 `FakeLlm`이 받은 요청을 뜯어 **인사 프롬프트에 일정이 안 실렸는지**까지 검증한다.

**알고 넘어갈 것**: 클라우드 모드에서 쿨다운은 유저 단위라 두 번째 기기는 조용하다. 그리고
배포 순서는 **Core 먼저** — 구 Core + 신 렌더러면 `greeting.run`이 method-not-found로 던지는데,
`useStartupStore`가 `error`만 세우고 넘어가므로 부팅이 막히진 않는다.

---

## D-026 — 목표 이정표: D-021의 "진척률 미구현"을 뒤집는다

**일자**: 2026-08-31

**맥락**: [D-021]은 목표에 "진척률·스트릭·대시보드·마일스톤·주간 회고·완료 추적"을 **의도적으로
넣지 않았다**. 이유가 명확했다 — 매일 오는 루틴 알림이 실제로 먹히는지부터 검증하고, 그 전에
계기판부터 만들면 안 쓰는 화면만 늘어난다.

그 검증이 끝났다(루틴 알림은 v0.1.x로 배포돼 돌고 있다). 그리고 리디자인이 **이정표를 목표
화면의 중심**으로 삼았다 — 목록은 진행률 막대가 붙은 한 줄, 상세는 "이유 → 이정표 → 꾸준한
노력". 그래서 판단을 뒤집는다.

**결정**: `goal_milestones` 테이블(제목·달성 여부·달성 시각·순서) + `goals.target_ym`.
UI는 목록(불릿 + 미니 진행 바)과 상세(산길 SVG 위 노드).

**진행률은 저장하지 않는다.** 완료/전체를 반환 지점마다 계산한다. 저장하면 이정표를 지우거나
순서를 바꿀 때 동기화할 대상이 하나 더 생긴다 — 브리핑의 `goal_lines`를 캐시하지 않은 것과
같은 판단이다. 계산은 **내림**이다(3개 중 2개 = 66%). 반올림하면 하나 남았는데 100%가 뜬다.

**편집 저장은 통째 교체가 아니라 id 기준 reconcile이다.** `whys`는 지웠다 넣는다(`replace_whys`)
— 텍스트뿐이라 잃을 게 없다. 이정표는 `done`/`done_at`을 들고 있어서 같은 방식으로 하면
**제목 한 글자 고치는 편집에 달성 기록이 전부 날아간다.** 그래서 draft가 `{id?, title}`을
싣고, id가 있으면 제목·순서만 고치고 없으면 삽입, 빠진 id는 삭제한다.

**체크는 별도 경로**(`goals.milestoneToggle`)다. 자주 일어나는 동작인데 목표 전체를 보내는 건
과하고, 순서 편집과 같은 경로로 묶으면 "체크하다가 순서가 되돌아가는" 사고가 난다.

**아직 안 한 것**: 디자인의 "꾸준한 노력"은 트리거(일어나자마자/자기 전…) 기준의 반복 할 일인데,
지금은 기존 루틴(요일 + 시각)을 그 자리에 보여준다. 트리거 전환은 [D-021]의 알림 모델을 바꾸는
별도 작업이라 뒤로 미뤘다(`docs/design/REDESIGN-PLAN.md`).
