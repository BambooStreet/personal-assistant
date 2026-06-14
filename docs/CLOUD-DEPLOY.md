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
