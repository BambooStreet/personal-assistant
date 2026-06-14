// 봇 설정 — 전부 환경변수(Fly secrets/로컬 env)에서. 비밀값은 로깅 금지.

export interface BotConfig {
  botToken: string;
  /** 허용된 텔레그램 chat id 집합. 이 목록이 곧 봇의 인증 경계. */
  allowedChatIds: Set<number>;
  /** 알림(notification.fired)을 보낼 오너 chat id. 미지정 시 allowed 첫 번째. */
  ownerChatId: number;
  /** pa-core 실행 파일 경로. */
  corePath: string;
  /** Core --data-dir. */
  dataDir: string;
  /** 데스크톱 접속용 WS 게이트웨이 인증 토큰(Phase 7, 전환기 병행). 없으면 세션 JWT만 허용. */
  gatewayToken: string | null;
  /** 게이트웨이 리슨 포트(Fly internal_port와 일치). */
  gatewayPort: number;
  /** Google 로그인 인증(범위 A). 셋 다 있어야 /auth/google 활성화. */
  ownerEmail: string | null;
  /** 데스크톱 로그인 OAuth client id(id_token aud 검증값). */
  googleLoginClientId: string | null;
  /** 세션 JWT 서명 비밀(HS256, ≥32B). */
  sessionSecret: string | null;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`환경변수 ${name}이(가) 필요합니다`);
  }
  return v.trim();
}

function parseIds(raw: string | undefined): number[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export function loadConfig(): BotConfig {
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const allowed = parseIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  if (allowed.length === 0) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_IDS에 최소 1개의 chat id가 필요합니다");
  }
  const ownerRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
  const ownerChatId = ownerRaw && Number.isFinite(Number(ownerRaw))
    ? Number(ownerRaw)
    : allowed[0];

  const gwPort = Number(process.env.PA_GATEWAY_PORT);
  return {
    botToken,
    allowedChatIds: new Set(allowed),
    ownerChatId,
    corePath: requireEnv("PA_CORE_BIN"),
    dataDir: process.env.PA_DATA_DIR ?? "/data",
    gatewayToken: process.env.PA_GATEWAY_TOKEN?.trim() || null,
    gatewayPort: Number.isFinite(gwPort) && gwPort > 0 ? gwPort : 8080,
    ownerEmail: process.env.OWNER_EMAIL?.trim().toLowerCase() || null,
    googleLoginClientId: process.env.GOOGLE_LOGIN_CLIENT_ID?.trim() || null,
    sessionSecret: process.env.PA_SESSION_SECRET?.trim() || null,
  };
}
