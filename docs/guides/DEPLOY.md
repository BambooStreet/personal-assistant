# 클라우드 배포 런북 (Phase 3 토큰 이식 + Phase 6 Fly.io)

폰(텔레그램)에서 PC가 꺼져 있어도 작동하게, `pa-core`+봇을 Fly.io에 올린다.
이 문서의 명령은 **오너가 본인 머신/계정에서** 실행한다(비밀값·Fly 계정 필요).

> 격리 모델은 D-013 참조. v0는 단일 오너(user_id=1), Google 연결은 플랫폼 전역(단일 계정).

## 0. 사전 준비
- `flyctl` 설치 + `fly auth login`.
- 텔레그램 [@BotFather]로 봇 생성 → **봇 토큰** 확보.
- 본인 **chat id** 확인(@userinfobot에게 아무 메시지나, 또는 봇에 메시지 후
  `https://api.telegram.org/bot<TOKEN>/getUpdates`의 `chat.id`).
- 코어 릴리스 빌드: `npm run build:core` → `core/target/release/pa-core.exe`(Windows).

## 1. 데스크톱에서 Google 연결 (이미 했으면 생략)
앱에서 Google 연결(OAuth) 1회 수행. 동의화면은 이미 Production(2026-06-10).
→ 장수명 refresh token이 OS 키체인에 저장됨.

## 2. 비밀값 추출 (Phase 3)
키체인의 비밀값을 `PA_SECRET_*=값` 형태로 출력하는 로컬 전용 도구:

```powershell
# 출력만 확인 (개인 터미널에서)
core\target\release\pa-core.exe --data-dir . --export-secrets
```

출력 예: `PA_SECRET_OPENAI_API_KEY=...`, `PA_SECRET_GOOGLE_CLIENT_ID=...`,
`PA_SECRET_GOOGLE_CLIENT_SECRET=...`, `PA_SECRET_GOOGLE_REFRESH_TOKEN=...`.
(access token은 1시간짜리라 이식 안 함 — 클라우드가 refresh로 재발급.)

## 3. Fly 앱·볼륨 생성
```bash
fly apps create personal-assistant-bot          # fly.toml의 app 이름과 일치시킬 것
fly volumes create pa_data -r nrt -n 1 -s 1      # SQLite 영속 볼륨(1GB, 도쿄)
```

## 4. 비밀값 주입
키체인 값은 파이프로 바로 import, 텔레그램 값은 직접 set:
```powershell
core\target\release\pa-core.exe --data-dir . --export-secrets | fly secrets import
fly secrets set TELEGRAM_BOT_TOKEN="<봇토큰>" TELEGRAM_ALLOWED_CHAT_IDS="<내chatid>"
# (선택) 알림 받을 chat이 허용목록 첫 번째가 아니면: TELEGRAM_OWNER_CHAT_ID="<chatid>"
```

## 5. 배포
```bash
fly deploy
```

## 6. 검증
- `fly logs` → `pa-core starting`, `db ready`, `core.ready`, `long-polling 시작`.
- 폰에서 봇에게 DM("오늘 일정 알려줘") → 응답.
- 일정 추가 요청 → 인라인 **예/아니요** → "예" → Core가 생성, 확인 메시지.
- 1시간/15분 내 시작하는 일정을 만들어 두면 스케줄러가 텔레그램으로 알림 푸시.
- `fly machine restart` 후에도 볼륨(`/data/pa.sqlite`) 유지 확인.

## 7. 트러블슈팅
- **invalid_grant**: refresh token 만료/취소. 데스크톱에서 재그랜트 → 2·4단계 재이식.
- **401 Unauthorized(telegram)**: 봇 토큰 오타 → `fly secrets set TELEGRAM_BOT_TOKEN=...`.
- **403 / scope 부족**: Google 동의 스코프(`calendar.events`) 확인. (project_google_oauth_production 참고)
- 봇이 "허가된 사용자만" 응답: `TELEGRAM_ALLOWED_CHAT_IDS`에 본인 chat id 포함 여부 확인.
- 비용 한도 초과 메시지: 설정의 일일 cap(기본 $1) 조정.

## 메모
- 봇은 인바운드 포트가 없는 워커(long-polling) → 공개 노출 0.
- 데스크톱은 아직 로컬 Core 사용(별도 채팅 스레드 `tg:<chatId>`). 폰·데스크톱이
  todos·메모리·캘린더는 user_id=1로 공유, 채팅 로그만 분리. 완전 통합은 Phase 8.
- 같은 캘린더를 데스크톱·클라우드가 둘 다 보므로 알림이 PC 팝업 + 텔레그램으로
  이중 발화될 수 있음(Phase 8 컷오버 시 해소).

## 8. 데스크톱 컷오버 (Phase 7–8)
데스크톱이 로컬 Core 대신 **클라우드 Core(게이트웨이)**를 쓰게 해 폰·데스크톱을 단일
두뇌로 합친다. 그러면 채팅 이력 통합 + 알림 이중 발화 해소(데스크톱 로컬 스케줄러 없어짐).
**트레이드오프: 데스크톱이 인터넷을 요구**(클라우드 의존). `PA_CORE_MODE`로 언제든 로컬 복귀.

### 8-1. 게이트웨이 활성화 (클라우드)
```powershell
# 강한 랜덤 토큰 생성
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
fly secrets set PA_GATEWAY_TOKEN="<위 토큰>"
fly deploy   # http_service(8080) 노출 + 게이트웨이 기동
```
확인: `fly logs`에 `[gateway] WS listening on :8080`. 엔드포인트는 `wss://<app>.fly.dev`.

### 8-2. (선택) 로컬 데이터 이행
캘린더는 이행 불필요(구글이 정답 → 클라우드가 자동 동기화 완료). 데스크톱에서만 만든
todos·메모리가 있으면 클라우드엔 없다. 중요하면 폰/데스크톱에서 수동으로 다시 추가하거나,
컷오버 전 캡처해두자. (v0는 자동 마이그레이션 미제공 — 채팅 이력은 새로 시작.)

### 8-3. 데스크톱을 remote 모드로
실행 전 환경변수 3개 설정(같은 토큰):
```powershell
$env:PA_CORE_MODE   = "remote"
$env:PA_GATEWAY_URL = "wss://personal-assistant-miya.fly.dev"
$env:PA_GATEWAY_TOKEN = "<8-1의 토큰>"
npm run dev   # 또는 패키징 앱 실행
```
- remote 모드에선 **로컬 Core를 안 띄움** → 단일 라이터(이중 쓰기/알림 방지).
- 연결되면 데스크톱 채팅·캘린더·할일이 클라우드(폰과 동일 데이터)로 동작.
- 끊기면 자동 재연결(백오프), UI엔 `core.crashed`로 표시.
- 로컬로 되돌리려면 `PA_CORE_MODE` 해제(또는 `local`) 후 재실행.

> 패키징 앱에서 환경변수 주입이 번거로우면, 후속으로 설정 UI 토글(coreMode)을 추가하는 게
> 자연스럽다(현재는 env 기반).

## 9. Google 로그인 빌드 (권장 컷오버 방식, 범위 A)
8절의 env 토큰 방식 대신 **진짜 로그인 흐름**. 데스크톱 앱이 Google 로그인 → 클라우드가 세션 JWT
발급 → 게이트웨이 접속. 오너 1명(이메일 화이트리스트)용. 설계: D-014.

### 9-1. Google "Desktop app" OAuth 클라이언트 생성
- Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID → **데스크톱 앱** → client id 확보.
  (loopback 리디렉션 자동 허용. client secret은 공개 클라이언트라 비밀 아님.)

### 9-2. 클라우드 시크릿 + 재배포
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # 세션 서명 비밀
fly secrets set OWNER_EMAIL="<오너 gmail>" GOOGLE_LOGIN_CLIENT_ID="<9-1 client id>" PA_SESSION_SECRET="<위 비밀>"
fly deploy
```
확인: `fly logs`에 `게이트웨이 인증: Google 로그인(세션 JWT)`.

### 9-3. 데스크톱 빌드에 client id 박기
`apps/main/src/config/cloud.config.ts`의 `BAKED.googleLoginClientId`에 9-1 client id 입력(비밀 아님, 커밋 가능).
gatewayUrl/HttpUrl이 본인 Fly 앱과 맞는지 확인.

### 9-4. 실행/검증
- dev: `$env:PA_CORE_MODE="remote"; npm run dev` → 패널에 "Google로 로그인" → 브라우저 동의 → 접속.
  (dev에서 client id를 env로 줘도 됨: `PA_GOOGLE_LOGIN_CLIENT_ID`, `PA_GOOGLE_LOGIN_CLIENT_SECRET`.)
- 패키징: `npm run package:win` → 설치본은 **기본 remote**(env 불필요) → 첫 실행 시 로그인 화면.
- 오너 이메일이 아니면 403("허용된 사용자가 아닙니다"). 세션 만료 시 자동으로 로그인 화면 복귀.

> 범위 B(타인 가입·per-user Google·결제)는 `SAAS-LAUNCH-PLAN.md`. 이음새는 `auth.ts mintSession`,
> `gateway.ts`(user_id 주입), `core-rpc supervisor.request`.
