// 클라우드 Core 앞단 WS 게이트웨이 + 인증 HTTP 엔드포인트.
// 데스크톱이 인터넷 너머에서 같은 Core에 접속하는 입구. 봇과 동일 프로세스라 Core 1개를 공유.
//
// 인증(범위 A): 데스크톱이 POST /auth/google로 Google id_token 제출 → 세션 JWT 발급,
// WS는 Authorization: Bearer <세션 JWT>로 인증(전환기 동안 PA_GATEWAY_TOKEN도 병행 허용).
// 허용 메서드는 CORE_FORWARD_METHODS만. Fly 공개 TLS(wss) 뒤. 비밀값(토큰/secret) 로깅 금지.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { CoreSupervisor } from "@pa/core-rpc";
import { CORE_FORWARD_METHODS } from "@pa/ipc-types";

import { AuthError, type Authenticator } from "./auth";

const ALLOWED = new Set<string>(CORE_FORWARD_METHODS as readonly string[]);

export interface GatewayHandle {
  /** Core 이벤트를 연결된 모든 클라이언트에 팬아웃. */
  broadcast: (name: string, data: unknown) => void;
}

export interface GatewayOptions {
  port: number;
  /** Google 로그인 인증기. 있으면 세션 JWT 발급/검증 활성화. */
  authenticator: Authenticator | null;
  /** 전환기 레거시 공유 토큰. 있으면 WS에서 병행 허용(세션 출시 후 제거). */
  legacyToken: string | null;
}

function legacyTokenOk(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${token}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export function startGateway(core: CoreSupervisor, opts: GatewayOptions): GatewayHandle {
  const clients = new Set<WebSocket>();

  const http = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/google") {
      handleAuthGoogle(req, res, opts.authenticator);
      return;
    }
    // 헬스체크/기타 → 200.
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });

  const wss = new WebSocketServer({ server: http });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    void authorizeWs(req.headers["authorization"], opts).then((userId) => {
      if (userId == null) {
        ws.close(1008, "unauthorized");
        return;
      }
      // userId는 범위 A에선 항상 1. (B에선 이 값을 RPC 엔벨로프에 주입.)
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.on("message", async (raw) => {
        let msg: { id?: number | string; method?: string; params?: unknown };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const { id, method, params } = msg;
        if (typeof method !== "string" || !ALLOWED.has(method)) {
          ws.send(JSON.stringify({ id, error: { message: `method not allowed: ${method}` } }));
          return;
        }
        try {
          // 범위 A: user_id 미주입(Core가 1로 귀착). B 이음새: 여기서 userId를 주입.
          const result = await core.request(method, params ?? null);
          ws.send(JSON.stringify({ id, result }));
        } catch (e) {
          ws.send(
            JSON.stringify({
              id,
              error: { message: e instanceof Error ? e.message : String(e) },
            }),
          );
        }
      });
    });
  });

  http.listen(opts.port, () => {
    console.info(`[gateway] WS listening on :${opts.port}`);
  });

  return {
    broadcast: (name, data) => {
      const payload = JSON.stringify({ type: "event", name, data });
      for (const ws of clients) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    },
  };
}

/** WS Authorization 헤더 인증. 성공 시 user_id, 실패 시 null. */
async function authorizeWs(
  header: string | undefined,
  opts: GatewayOptions,
): Promise<number | null> {
  const token = bearer(header);
  if (!token) return null;
  // 1) 세션 JWT
  if (opts.authenticator) {
    try {
      const claims = await opts.authenticator.verifySession(token);
      return claims.userId;
    } catch {
      // 폴백: 레거시 토큰
    }
  }
  // 2) 레거시 공유 토큰(전환기)
  if (opts.legacyToken && legacyTokenOk(header, opts.legacyToken)) {
    return 1;
  }
  return null;
}

/** POST /auth/google { id_token } → { session_token, expires_at } | 4xx. */
function handleAuthGoogle(
  req: IncomingMessage,
  res: ServerResponse,
  authenticator: Authenticator | null,
): void {
  if (!authenticator) {
    sendJson(res, 503, { error: "auth not configured" });
    return;
  }
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 64 * 1024) req.destroy(); // 비정상 대용량 차단
  });
  req.on("end", async () => {
    try {
      const parsed = JSON.parse(body) as { id_token?: unknown };
      if (typeof parsed.id_token !== "string") {
        sendJson(res, 400, { error: "id_token 필요" });
        return;
      }
      const { token, expiresAt } = await authenticator.issueSessionFromIdToken(parsed.id_token);
      sendJson(res, 200, { session_token: token, expires_at: expiresAt });
    } catch (e) {
      if (e instanceof AuthError) {
        sendJson(res, 403, { error: e.message });
      } else {
        sendJson(res, 400, { error: "invalid request" });
      }
    }
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
