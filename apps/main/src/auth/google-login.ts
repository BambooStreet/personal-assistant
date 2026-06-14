import http from "node:http";
import crypto from "node:crypto";
import { AddressInfo } from "node:net";

import { handleShellOpenExternal } from "../oauth-shell";

// 데스크톱 Google 로그인(범위 A). Rust core의 루프백 OAuth 패턴을 Main(TS)으로 포팅.
// 원격 모드 데스크톱은 로컬 core를 띄우지 않으므로 로그인은 Main이 직접 수행한다.
// scope는 openid email만(캘린더 X — 캘린더는 클라우드가 전역 연결로 처리).
// 결과 = id_token(JWT). 실제 신원 검증은 클라우드 /auth/google이 한다.

const AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const CALLBACK_TIMEOUT_MS = 300_000;

export interface GoogleLoginResult {
  idToken: string;
  email?: string;
}

export interface GoogleLoginOptions {
  clientId: string;
  /** Desktop-app OAuth 클라이언트의 secret(공개 클라이언트라 비밀 아님). 없으면 생략. */
  clientSecret?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const seg = jwt.split(".")[1];
  if (!seg) return null;
  try {
    const json = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const SUCCESS_HTML =
  "<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;text-align:center;padding:3rem'>" +
  "<h2>로그인 완료</h2><p>이 창을 닫고 앱으로 돌아가세요.</p></body>";
const ERROR_HTML =
  "<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;text-align:center;padding:3rem'>" +
  "<h2>로그인 실패</h2><p>앱에서 다시 시도해 주세요.</p></body>";

/** 시스템 브라우저로 Google 로그인 → id_token 반환. 사용자가 닫거나 시간 초과 시 reject. */
export async function runGoogleLogin(opts: GoogleLoginOptions): Promise<GoogleLoginResult> {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  const nonce = base64url(crypto.randomBytes(16));

  const { code, redirectUri } = await waitForCode(state);

  // code → token 교환. id_token 획득.
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: opts.clientId,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  if (opts.clientSecret) body.set("client_secret", opts.clientSecret);

  const resp = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    // Google 오류 본문(error/error_description)을 노출 — 비밀값 없음(client_secret 등은 미포함).
    let detail = "";
    try {
      const j = (await resp.json()) as { error?: string; error_description?: string };
      detail = j.error_description || j.error || "";
    } catch {
      /* ignore */
    }
    throw new Error(`토큰 교환 실패 (${resp.status})${detail ? `: ${detail}` : ""}`);
  }
  const tokens = (await resp.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new Error("id_token이 응답에 없습니다");
  }

  const payload = decodeJwtPayload(tokens.id_token);
  if (payload && payload["nonce"] && payload["nonce"] !== nonce) {
    throw new Error("nonce 불일치");
  }
  const email = payload && typeof payload["email"] === "string" ? (payload["email"] as string) : undefined;
  return { idToken: tokens.id_token, email };

  // ── 내부: 루프백 콜백 서버 + 브라우저 오픈 ─────────────────────────────────
  function waitForCode(expectedState: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/") {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const gotState = url.searchParams.get("state");
        if (err || !code || gotState !== expectedState) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(ERROR_HTML);
          cleanup();
          reject(new Error(err ? `Google 오류: ${err}` : "콜백 검증 실패(state/code)"));
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SUCCESS_HTML);
        cleanup();
        resolve({ code, redirectUri });
      });

      let redirectUri = "";
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("로그인 시간이 초과되었습니다"));
      }, CALLBACK_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timer);
        server.close();
      }

      server.on("error", (e) => {
        cleanup();
        reject(e);
      });

      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as AddressInfo).port;
        redirectUri = `http://127.0.0.1:${port}`;
        const authUrl = new URL(AUTH_URI);
        authUrl.search = new URLSearchParams({
          client_id: opts.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid email",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: expectedState,
          nonce,
          access_type: "online",
          prompt: "select_account",
        }).toString();
        // 호스트 허용목록(accounts.google.com) 검증을 거쳐 시스템 브라우저로 오픈.
        handleShellOpenExternal({ url: authUrl.toString() });
      });
    });
  }
}
