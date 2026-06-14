# 클라우드 봇 이미지(Phase 6). pa-core(Linux) + Node 텔레그램 봇을 한 프로세스로.
# 멀티스테이지: ① Rust로 pa-core 빌드 → ② Node 워크스페이스 빌드 → ③ 런타임.

# ── ① Rust: pa-core(Linux) 빌드 ───────────────────────────────────────────────
# keyring은 cfg(target_os) 한정이라 Linux 그래프에서 제외됨(Phase 2) → FileBackend 사용.
FROM rust:1-bookworm AS rust
WORKDIR /core
COPY core/ ./
RUN cargo build --release

# ── ② Node: ipc-types → core-rpc → cloud-bot 빌드 ─────────────────────────────
FROM node:22-bookworm-slim AS node
WORKDIR /app
# 데스크톱 전용 의존(electron)의 바이너리 다운로드 생략 — 봇 이미지엔 불필요.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN npm ci
RUN npm run build:cloud-bot

# ── ③ 런타임 ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# reqwest(rustls)는 webpki 루트를 쓰지만, 안전하게 시스템 CA도 둔다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# 빌드된 워크스페이스(심링크 포함 node_modules)와 Linux 코어 바이너리 복사.
COPY --from=node /app /app
COPY --from=rust /core/target/release/pa-core /app/bin/pa-core
ENV NODE_ENV=production \
    PA_CORE_BIN=/app/bin/pa-core \
    PA_DATA_DIR=/data
RUN mkdir -p /data
# 봇이 pa-core를 stdio로 spawn하고 텔레그램 long-polling(아웃바운드만) 수행.
CMD ["node", "apps/cloud-bot/dist/index.js"]
