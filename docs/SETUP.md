# Setup — 개발 환경 재현

다른 컴퓨터에서 같은 의존성으로 개발 이어가기 위한 가이드. Windows 기준 (macOS는 마지막에 따로).

---

## 시스템 요구사항

| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | **20.19+** 또는 22.12+ | Vite 7.3.x가 요구. 20.15.x에선 EBADENGINE 경고 발생 (동작은 하지만 권장 X) |
| npm | 10.x | Node와 함께 설치됨 |
| Rust toolchain | stable, MSVC | rustup-init으로 |
| Visual Studio Build Tools | 2022 | "C++로 데스크톱 개발" 워크로드 (MSVC, Windows SDK) |
| Git | 최신 | |

### 1. Node.js 20.19+

https://nodejs.org/ 에서 LTS 받기. 20.x LTS 최신 또는 22.x LTS.

```powershell
node --version
npm --version
```

### 2. Rust toolchain

https://rustup.rs/ 에서 `rustup-init.exe` 실행 → 기본값 (stable, x86_64-pc-windows-msvc).

```powershell
rustc --version
cargo --version
```

PowerShell 새 세션에서 `cargo`가 안 잡히면 PATH에 `%USERPROFILE%\.cargo\bin` 등록 확인.

### 3. Visual Studio Build Tools

https://visualstudio.microsoft.com/ko/visual-cpp-build-tools/ 에서 다운로드. 설치 시 워크로드 **"C++로 데스크톱 개발" (Desktop development with C++)** 선택. MSVC v143, Windows 10/11 SDK 포함.

이게 없으면 `cargo build`가 `link.exe` 못 찾아 실패함.

### 4. Git

https://git-scm.com/ — 기본 옵션으로.

---

## 초기 클론

```powershell
git clone https://github.com/BambooStreet/personal-assistant.git
cd personal-assistant
git checkout migrate/electron
```

---

## 의존성 설치

```powershell
npm install
```

- `package-lock.json` 기반으로 정확히 같은 버전을 설치
- 첫 install은 5~10분 (electron, tfjs, speech-commands가 큼)
- 1 high severity vulnerability 경고가 나올 수 있음 (transitive — 무시 가능)

Rust 의존은 첫 빌드 시 자동으로 받아옴. 바로 빌드해보면:

```powershell
npm run build:core
```

처음에는 Rust 크레이트 컴파일에 5~10분 (sqlx, reqwest, tokio 등). 이후 증분 빌드는 빠름.

---

## 실행

```powershell
npm run dev:main
```

- `npm run build:core` 자동 선행 → `pa-core.exe` 생성
- Electron Main이 `pa-core` 자식 프로세스로 spawn
- Renderer Vite dev 서버는 `http://localhost:1420`에서 자동 로드

처음 실행 시 onboarding 화면이 뜸 (OpenAI 키 / Google / 마이크 안내).

---

## 첫 실행 시 입력해야 할 것 (장비별)

OS 키체인 항목은 컴퓨터마다 별개. 한 노트북에서 입력했다고 다른 노트북에 자동 동기화되지 않음.

### 필수
1. **OpenAI API 키** — 패널 → 설정 → API 또는 onboarding의 첫 단계
   - 같은 키를 재사용해도 됨 (sk-... 그대로)

### 선택
2. **Google Client ID / Secret** — 같은 Google Cloud 프로젝트의 값을 재사용
   - 첫 노트북에서 만든 OAuth 클라이언트 그대로 사용 가능
3. **Google 연결** — 입력 후 "연결" 버튼 → 브라우저 동의 화면. 같은 Google 계정으로 로그인

---

## 데이터 동기화 (선택)

기본적으로 각 노트북은 독립된 SQLite DB / IndexedDB를 가짐. 채팅 기록 / 할 일 / 캘린더 캐시 / wake word 모델이 다 따로.

### 한 컴퓨터의 DB를 다른 곳으로 옮기기
앱 종료 후:

```
%APPDATA%\dev.ohmyhong.personalassistant\pa.sqlite
%APPDATA%\dev.ohmyhong.personalassistant\avatar-window-state.json
```

이 두 파일을 다른 노트북의 같은 경로로 복사. (사용 중인 동안 복사하면 SQLite 락 충돌)

### 같이 옮기지 않는 것
- **OS 키체인 항목** (OpenAI 키, Google 클라이언트, refresh token) — 양쪽 노트북에 직접 입력
- **Wake word 학습 모델** — IndexedDB는 BrowserWindow origin 스코프. 노트북마다 따로 학습 필요 (또는 향후 export/import 기능 추가 시)
- **음성 캐시** — 메모리만 있어 옮길 의미 없음

---

## 자주 보는 이슈

### `cargo: command not found`
PATH에 `%USERPROFILE%\.cargo\bin` 누락. PowerShell 재시작 또는:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

### `error: linker 'link.exe' not found`
Visual Studio Build Tools 미설치 또는 C++ 워크로드 누락. Build Tools Installer에서 워크로드 추가.

### `EBADENGINE` 경고
Node 버전이 20.19 미만. 20.19+ 또는 22.12+로 업그레이드.

### 첫 dev:main이 너무 오래 걸림
- 첫 Rust 빌드 (5~10분)
- 첫 Vite optimizeDeps (tfjs pre-bundle, ~15초)
이후엔 정상 속도.

### Electron 창이 작업 표시줄엔 뜨는데 화면엔 안 보임
이전 세션에서 화면 밖으로 드래그 후 종료된 경우.

```
%APPDATA%\dev.ohmyhong.personalassistant\avatar-window-state.json
```

이 파일 삭제 후 재실행하면 화면 중앙에 다시 뜸.

### Wake word 학습이 첫 실행에 멈춰 있음
설정 → 음성 탭에서 "TF.js 모듈 번들링 중..." 표시되면 정상. 첫 1회 처리에 오래 걸리고 이후 캐시됨. 진행 막대가 멈춰 보이면 DevTools Console에서 에러 확인.

---

## macOS 차이

```bash
xcode-select --install                                            # CLT
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh    # Rust
brew install node                                                  # Node 20.19+
git clone ... && cd personal-assistant
git checkout migrate/electron
npm install
npm run dev:main
```

차이점:
- 데이터 경로: `~/Library/Application Support/dev.ohmyhong.personalassistant/`
- 키체인: macOS Keychain
- 마이크 권한: 첫 사이클 때 OS 시스템 다이얼로그로 요청
- 자동시작: `LSSharedFileList` 등록 (dev 모드에선 Electron.app 경로)

---

## 빠른 참조

```powershell
# 클론 + 환경 준비
git clone https://github.com/BambooStreet/personal-assistant.git
cd personal-assistant
git checkout migrate/electron

# 한 번만
npm install
npm run build:core

# 매번
npm run dev:main
```
