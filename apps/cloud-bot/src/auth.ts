// Google 로그인 인증(범위 A). 데스크톱이 보낸 Google id_token을 검증하고 오너(이메일 화이트리스트)면
// HMAC 세션 JWT를 발급한다. 게이트웨이 WS는 이 세션 JWT로 인증.
// 비밀값(id_token·세션 JWT·secret)은 절대 로깅 금지.

import { OAuth2Client } from "google-auth-library";
import { SignJWT, jwtVerify } from "jose";

const ISS = "pa-gateway";
const AUD = "pa-desktop";
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30일

export interface AuthConfig {
  ownerEmail: string;
  googleLoginClientId: string;
  sessionSecret: string;
}

export interface SessionClaims {
  /** 테넌트. 범위 A는 항상 1(오너). */
  userId: number;
  /** 세션 주체 이메일. */
  sub: string;
}

/** 인증 실패(이메일 미검증/오너 아님 등). 메시지는 사용자 표시 가능 수준만. */
export class AuthError extends Error {}

/** 세 값이 모두 있을 때만 인증 활성화. 없으면 null(레거시 토큰 모드). */
export function makeAuthenticator(cfg: {
  ownerEmail: string | null;
  googleLoginClientId: string | null;
  sessionSecret: string | null;
}): Authenticator | null {
  if (!cfg.ownerEmail || !cfg.googleLoginClientId || !cfg.sessionSecret) return null;
  return new Authenticator({
    ownerEmail: cfg.ownerEmail,
    googleLoginClientId: cfg.googleLoginClientId,
    sessionSecret: cfg.sessionSecret,
  });
}

export class Authenticator {
  private google: OAuth2Client;
  private secret: Uint8Array;

  constructor(private cfg: AuthConfig) {
    this.google = new OAuth2Client(cfg.googleLoginClientId);
    this.secret = new TextEncoder().encode(cfg.sessionSecret);
  }

  /** Google id_token 검증 + 오너 확인 → 세션 JWT 발급. 실패 시 AuthError. */
  async issueSessionFromIdToken(idToken: string): Promise<{ token: string; expiresAt: string }> {
    let payload;
    try {
      const ticket = await this.google.verifyIdToken({
        idToken,
        audience: this.cfg.googleLoginClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new AuthError("id_token 검증 실패");
    }
    if (!payload || payload.email_verified !== true || !payload.email) {
      throw new AuthError("이메일이 검증되지 않았습니다");
    }
    if (payload.email.toLowerCase() !== this.cfg.ownerEmail) {
      throw new AuthError("허용된 사용자가 아닙니다");
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + SESSION_TTL_SEC;
    // 범위 A: user_id=1 고정. B에선 이메일→실유저 매핑으로 교체.
    const token = await new SignJWT({ user_id: 1, sub: payload.email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime(exp)
      .sign(this.secret);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** 세션 JWT 검증 → claims. 실패 시 throw. */
  async verifySession(jwt: string): Promise<SessionClaims> {
    const { payload } = await jwtVerify(jwt, this.secret, {
      issuer: ISS,
      audience: AUD,
    });
    const userId = typeof payload.user_id === "number" ? payload.user_id : 1;
    return { userId, sub: typeof payload.sub === "string" ? payload.sub : "" };
  }
}
