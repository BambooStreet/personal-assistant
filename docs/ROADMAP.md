# Roadmap

기록 시점: 2026-05-03. 우선순위는 위에서 아래로.
이 문서는 **데스크톱 아바타/음성 기능 백로그**다. 클라우드·멀티테넌트 SaaS 출시 3개월 실행 계획은 `docs/SAAS-LAUNCH-PLAN.md` 참조.

---

## 즉시 다음 — Avatar Phase C-2: Active Listening

학습된 wake word 모델을 항상 켜두고 호칭이 감지되면 voice 사이클을 자동 트리거한다.

### 작업
1. `AvatarApp`에 `useWakeWordListener` hook 추가
   - settings의 `voice.enabled === true`일 때만 detector 로드 + listen 시작
   - detector.listen 콜백에서 `voiceController.wake()` 직접 호출 (또는 `voice.wake` 이벤트 브로드캐스트로 통일)
   - 컴포넌트 unmount / 토글 OFF 시 stopListen
2. **윈도우 간 settings 동기화**: 패널에서 토글하면 아바타 윈도우도 즉시 반영해야 함
   - Main에서 `setting.changed` 이벤트 브로드캐스트, 양쪽 store가 reload
   - 또는 특정 키만 broadcast (`voice.enabled`, `user.name` 등)
3. **시각적 마이크 활성 표시**: 아바타 좌하단에 작은 빨간 dot — listening 모드가 ON일 때만
4. **임계값 / suppressionMs 튜닝 UI**: 검증 화면에서 임계값 slider 추가, 저장은 settings에 (`wake.threshold`)
5. **단축키와의 우선순위**: 둘 다 `voice.wake` 이벤트로 진입. VoiceController가 phase 체크로 중복 차단 — 이미 됨.

### 검증
- 호칭 외 단어 / 일반 대화 / TV 소리에 가짜 트리거 ≤ 5분에 1회 미만이면 OK
- 호칭 발화 시 트리거율 ≥ 90%
- listening 모드 ON/OFF 토글 즉시 반영 (양쪽 윈도우)

---

## Phase C-3: 온라인 개선 루프

학습된 모델을 사용하면서 정확도를 자동으로 올리는 루프.

### 데이터 수집
- Wake 감지 → attentive(인사) → listening 진입
- listening에서 N초 내에 사용자 음성이 실제로 캡처됐는가?
  - **Yes (True Positive 후보)**: wake 트리거 직전 1초 spectrogram을 positive 샘플로 저장
  - **No (False Positive 의심)**: 따로 저장. 즉시 학습엔 반영 X — 검토 큐
- 사용자가 사이클 중 명시적으로 "잘못 들었어" 버튼 (UI 추가) → 강제 negative
- 비슷한 상황에서 사용자가 다른 명령어 (마이크 버튼)로 진행했다면 — wake가 놓친 케이스로 별도 큐

### 학습 루프
- 매 N개 (예: 20) 새 sample 누적 또는 매주 / 사용자 수동 트리거 → 백그라운드 retrain
- 검증셋(초기 학습 후 분리)에 대한 precision/recall 비교
  - 떨어지면 새 모델 폐기, 기존 유지 (rollback)
  - 올라가면 atomic하게 활성 모델 교체
- 통계 UI: 누적 positive/negative 카운트, 최근 정확도 트렌드, 마지막 retrain 시점

### 데이터 영속화
- spectrogram (Float32Array) + 라벨 + timestamp을 IndexedDB에 저장
- 검증셋은 분리 저장 (학습에 사용 X)
- 사용자가 수동으로 데이터셋 export/import 가능 (선택)

---

## Phase D: 화자 검증 (Speaker Verification)

호칭만으로는 옆 사람도 트리거 가능. 사용자 본인 목소리만 통과시키는 추가 게이트.

### 후보
- TF.js 포팅된 speaker embedding 모델 (예: ECAPA-TDNN, 또는 가벼운 ResNet)
- 등록 단계에서 사용자 voice fingerprint 학습/저장
- wake 감지 후 짧은 후속 발화에 대해 speaker match score 계산
- 둘 다 통과해야 listening 진입

### 우선순위
1.x 이후. 단일 사용자 데스크톱 시나리오에서는 없어도 큰 문제 없음.

---

## Phase E: Lip-sync (TTS 발화 시 입 모양 동기)

speaking 상태에서 시각적 만족도를 크게 올림.

### 옵션
- A. 정적 PNG 입 부분 분리 → 오디오 RMS/주파수 분석으로 입 레이어 swap (가장 가벼움)
- B. Live2D 도입 + ParamMouthOpenY 구동 (큰 작업, 1.x+)
- C. 단순한 4프레임 mouth-shape 애니메이션 + RMS 기반 인덱스 선택

A부터 prototype 권장.

---

## EM7 보류 항목

### 글로벌 단축키 (위젯 토글)
현재 `Ctrl+Shift+Space`는 voice wake로 사용 중. 별도로 위젯 show/hide 단축키가 필요한지는 사용자 피드백 받아 결정. 후보: `Ctrl+Shift+A` (avatar) / `Ctrl+Shift+P` (panel).

### 자동 업데이트 + 패키징

**규모**: 중대형. 코드사이닝 결정 동반.

1. `electron-builder` 도입 + Rust 코어 바이너리 `extraResources` 동봉
2. GitHub Actions matrix (Windows + macOS) → installer 빌드 → Releases 업로드
3. `electron-updater` + `autoUpdater.checkForUpdatesAndNotify()`
4. 사용자에게 "업데이트 다운로드 중", "재시작 시 적용" 트레이 토스트

**옵션**:
- A. 미서명: 처음 설치 시 SmartScreen / Gatekeeper 경고. 자동 업데이트는 동작하나 매 업데이트마다 사용자 액션 필요
- B. EV / Apple Developer 풀 서명: 연 $400~ (Win OV/EV) + $99 (Apple). CI에 secrets 등록

옵션 A로 시작 → 사용자 베이스 안정화 후 B로 전환 권장.

---

## Avatar / 위젯 추가 아이디어

### Avatar 커스터마이징
- 사용자가 PNG 4종 업로드 (idle / listening / thinking / speaking + attentive)
- 프리셋 (cat / dog / robot 등 미리 만든 세트)
- 사이즈/투명도 조절

### Live2D 통합
- pixi.js + pixi-live2d-display
- 표정 모션 매핑 + lip-sync (Phase E와 연계)
- 모델 라이선스 / 제작 파이프라인 별개 작업

### 상태 확장
- error: API 실패 / cap 초과 → 살짝 흔들림
- notification: 새 일정 알림 → 한 번 점프
- 응답 도착 직후 잠깐 happy → idle (transition queue)

---

## Core / 백엔드 아이디어

### 더 많은 도구 통합
- 메일 (Gmail) — 읽기/요약
- 브라우저 / 탐색 — 사용자 컴퓨터의 OS 자동화 (큰 권한 결정 동반)
- 노션, 슬랙, 옵시디언 등 외부 통합

### 모델 옵션
- Claude / 로컬 LLM (ollama) 어댑터
- 응답 streaming (현재는 한 번에 도착) — chat UX 향상

### 데이터 관리 UI
- 채팅/일정/할 일 export
- DB 백업 / 복원
- "이 대화 잊어버려" 부분 삭제

---

## 기술 부채 / 정리

### Vite + tfjs 번들 크기
- 현재 dev에서 첫 import 시 느림 → optimizeDeps로 완화
- 프로덕션 빌드 시 chunk splitting 검토 (음성 탭 진입 전엔 tfjs 미로드)
- 베이스 모델 가중치 동봉 vs CDN 의존 결정

### Sandbox
- 현재 `sandbox: false` (preload에서 require 사용). 가능하면 sandbox: true로 전환 검토

### 테스트
- Core: sqlx mock + Whisper/TTS HTTP mock
- Renderer: 컴포넌트 / store 단위
- 통합: Node 스크립트로 Core spawn + JSON-RPC 라운드트립

### ESLint
- `no-restricted-imports`로 `@tauri-apps/*` 재유입 차단 (의존 자체는 제거됨이나 룰로 enforce)
