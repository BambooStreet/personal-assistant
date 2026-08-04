# 아키텍처 한눈에 보기

> Personal Assistant — 데스크톱 위젯형 AI 비서.
> 이 문서는 **구조를 한눈에** 파악하기 위한 그림 모음이다. GitHub·VS Code에서 Mermaid로 렌더된다.
> 상세 동작·불변식은 각 도메인 문서(`docs/<domain>/`)가 정본. 여기는 지도.

---

## 1. 전체 구조 (3-tier + 클라우드)

```mermaid
graph TB
  subgraph Desktop["🖥️ Desktop App (Electron)"]
    direction TB
    subgraph R["@pa/renderer — React UI"]
      RUI["Avatar · Panel<br/>Chat · Todos · Calendar<br/>Briefing · Voice · Settings"]
    end
    subgraph M["@pa/main — Electron Main"]
      MCore["IPC Handlers · Window/Tray<br/>Auth(OAuth) · Notifications<br/>Core Supervisor"]
    end
    subgraph C["core — pa-core (Rust)"]
      CC["commands: chat·todos·calendar<br/>travel·briefing·memory·speech"]
      CS["services: llm · calendar · speech<br/>travel · notifications · schedule"]
      CI["infra: SQLite · OAuth · secrets · telemetry"]
      CC --> CS --> CI
    end
    R -- "Electron IPC<br/>(invoke / event)" --> M
    M -- "stdio JSON-RPC<br/>(line-delimited)" --> C
  end

  subgraph Cloud["☁️ @pa/cloud-bot (Node.js)"]
    GW["WS Gateway"]
    TG["Telegram Bot"]
    RC["원격 pa-core"]
    GW --> RC
    TG --> RC
  end

  M -. "WebSocket (원격 모드)<br/>Google OAuth + JWT" .-> GW
  CI --> GAPI["Google APIs<br/>Calendar · OAuth"]
  CS --> LLM["OpenAI / Whisper / TTS"]

  classDef rend fill:#1e3a5f,stroke:#4a90d9,color:#fff
  classDef main fill:#3d2f5f,stroke:#9b6dd9,color:#fff
  classDef core fill:#5f3a1e,stroke:#d99a4a,color:#fff
  classDef ext fill:#2d2d2d,stroke:#888,color:#ddd
  class R,RUI rend
  class M,MCore main
  class C,CC,CS,CI core
  class Cloud,GW,TG,RC,GAPI,LLM ext
```

**핵심 원칙**
- **데이터/상태는 전부 Core**(Rust + SQLite). Renderer는 그리기만, Main은 창·OS 연동·forward만.
- Renderer는 파일/DB 직접 접근 금지 — 반드시 IPC → Core.
- 계층 간 통신은 딱 둘: **Renderer↔Main = Electron IPC**, **Main↔Core = stdio JSON-RPC**.

---

## 2. 워크스페이스 의존 관계 (npm monorepo)

```mermaid
graph LR
  IPC["@pa/ipc-types<br/>methods · schemas · events"]
  RPC["@pa/core-rpc<br/>stdio JSON-RPC 전송"]
  REN["@pa/renderer"]
  MAIN["@pa/main"]
  BOT["@pa/cloud-bot"]
  CORE["core (pa-core.exe)<br/>Rust"]

  IPC --> REN
  IPC --> MAIN
  IPC --> BOT
  RPC --> MAIN
  RPC --> BOT
  MAIN -->|spawn/supervise| CORE
  BOT -->|spawn| CORE

  classDef pkg fill:#1e3a5f,stroke:#4a90d9,color:#fff
  classDef app fill:#3d2f5f,stroke:#9b6dd9,color:#fff
  classDef rust fill:#5f3a1e,stroke:#d99a4a,color:#fff
  class IPC,RPC pkg
  class REN,MAIN,BOT app
  class CORE rust
```

`workspaces: ["apps/*", "packages/*"]`. `core`(Rust)는 npm 워크스페이스가 아니라 별도 프로세스로, Main/cloud-bot이 supervisor로 띄운다.

---

## 3. IPC 5-지점 계약 (메서드 하나 = 5곳 동기화)

> 새 IPC 메서드 추가/이름 변경 시 아래 5곳을 **전부** 맞춰야 함. 하나라도 빠지면 런타임에 깨짐.

```mermaid
graph LR
  A["1️⃣ methods.ts<br/>Methods + CORE_FORWARD_METHODS"] --> B["2️⃣ preload.ts<br/>api 메서드"]
  B --> C["3️⃣ ipc.ts<br/>forward() / 커스텀 핸들러"]
  C --> D["4️⃣ main.rs<br/>dispatch match arm"]
  A --> E["5️⃣ schemas.ts<br/>zod payload"]
  E -.검증.-> C

  classDef ts fill:#1e3a5f,stroke:#4a90d9,color:#fff
  classDef rust fill:#5f3a1e,stroke:#d99a4a,color:#fff
  class A,B,C,E ts
  class D rust
```

**메서드 도메인 분류**

| 처리 위치 | 도메인 |
|---|---|
| **Core forward** (JSON-RPC로 Core에 전달) | `app` · `secret` · `settings` · `chat` · `todos` · `oauth` · `calendar` · `schedule` · `travel` · `memory` · `briefing` · `speech` |
| **Main 자체 처리** (Core forward 없음) | `window` · `auth` · `autoLaunch` · `debug` |

메서드명은 `<domain>.<verb>` dot.case.

---

## 4. 데이터 흐름 예시 — `chat.send`

```mermaid
sequenceDiagram
  participant U as 사용자
  participant R as Renderer<br/>(React)
  participant M as Main<br/>(Electron)
  participant C as Core<br/>(Rust)
  participant L as OpenAI

  U->>R: 메시지 입력
  R->>M: ipcRenderer.invoke("chat.send", payload)
  M->>C: stdin: {jsonrpc, method:"chat.send"}\n
  C->>C: dispatch → services/llm
  C->>L: Chat Completion (+ tool defs)
  L-->>C: 응답 / tool_call
  Note over C: tool_call이면 calendar·todos·travel<br/>실행 후 chat.continue로 재호출
  C-->>M: stdout: RPC 응답 + emit(event:...)
  M-->>R: invoke resolve + broadcast(event)
  R-->>U: 아바타 말풍선 / TTS 재생
```

이벤트(알림·비용 갱신 등)는 Core가 `emit("event:...")` → Main이 여러 윈도우로 `broadcast` → Renderer가 `ipcRenderer.on`으로 수신.

---

## 5. Core(Rust) 도메인 지도

```mermaid
graph TB
  subgraph cmd["commands/ (RPC 진입)"]
    c1[chat] & c2[todos] & c3[calendar] & c4[travel]
    c5[briefing] & c6[memory] & c7[speech] & c8[oauth] & c9[settings]
  end
  subgraph svc["services/ (도메인 로직 + DB)"]
    s1["llm/<br/>openai · dispatch · cost · tools"]
    s2["calendar/<br/>google · sync"]
    s3["speech/<br/>tts · whisper · cost"]
    s4["travel/<br/>geocode · route · pure"]
    s5["notifications · schedule · briefing · memory"]
  end
  subgraph inf["infra/"]
    i1["db (SQLite)<br/>migrations 0001–0009"]
    i2["secrets (keyring)"]
    i3["oauth (Google)"]
    i4["telemetry (OTel/LangSmith)"]
  end
  c1-->s1
  c3-->s2
  c7-->s3
  c4-->s4
  c5-->s5
  svc-->inf

  classDef box fill:#5f3a1e,stroke:#d99a4a,color:#fff
  class cmd,svc,inf,c1,c2,c3,c4,c5,c6,c7,c8,c9,s1,s2,s3,s4,s5,i1,i2,i3,i4 box
```

---

## 참고
- 명령어·검증·커밋 규칙: 루트 `CLAUDE.md`
- 도메인 지식 맵: `docs/README.md` → 각 `docs/<domain>/` (UI는 `docs/UI/windowing.md`가 정본)
- 교차-관심 설계 결정: `docs/DECISIONS.md` (D-번호)
