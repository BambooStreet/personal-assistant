// Phase 7: 클라우드 Core 앞단 WS 게이트웨이. 데스크톱(Phase 8)이 인터넷 너머에서
// 같은 Core에 접속하는 입구. 봇과 동일 프로세스라 supervisor(=Core 1개)를 공유한다.
//
// 인증: Authorization: Bearer <PA_GATEWAY_TOKEN>. 허용 메서드는 CORE_FORWARD_METHODS만.
// Fly 공개 TLS(wss) 종단 뒤에 둔다. 비밀값은 로깅 금지.

import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { CoreSupervisor } from "@pa/core-rpc";
import { CORE_FORWARD_METHODS } from "@pa/ipc-types";

const ALLOWED = new Set<string>(CORE_FORWARD_METHODS as readonly string[]);

export interface GatewayHandle {
  /** Core 이벤트를 연결된 모든 클라이언트에 팬아웃. */
  broadcast: (name: string, data: unknown) => void;
}

function tokenOk(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${token}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startGateway(
  core: CoreSupervisor,
  opts: { token: string; port: number },
): GatewayHandle {
  const clients = new Set<WebSocket>();

  // 일반 HTTP 요청엔 200(헬스체크용). WS 업그레이드만 게이트웨이로.
  const http = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });

  const wss = new WebSocketServer({ server: http });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (!tokenOk(req.headers["authorization"], opts.token)) {
      ws.close(1008, "unauthorized");
      return;
    }
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
