import { runGoogleLogin } from "./google-login";
import { clearSession, loadSession, saveSession } from "./session-store";

// 로그인 orchestration: Google 로그인 → 클라우드 /auth/google에서 세션 JWT 발급 → 저장.
// core 연결/해제는 index.ts가 onAuthenticated/onLoggedOut 훅으로 처리(순환 의존 회피).

export interface AuthStatus {
  signedIn: boolean;
  email?: string;
}

export interface AuthManager {
  login(): Promise<AuthStatus>;
  status(): AuthStatus;
  logout(): Promise<void>;
}

export interface AuthDeps {
  gatewayHttpUrl: string;
  googleLoginClientId: string;
  googleLoginClientSecret?: string;
  /** 세션 확보 후(로그인/부팅) core 연결. */
  onAuthenticated: (sessionToken: string) => void;
  /** 로그아웃 시 core 종료. */
  onLoggedOut: () => void;
}

function decodeSub(jwt: string): string | undefined {
  const seg = jwt.split(".")[1];
  if (!seg) return undefined;
  try {
    const json = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const p = JSON.parse(json) as { sub?: unknown };
    return typeof p.sub === "string" ? p.sub : undefined;
  } catch {
    return undefined;
  }
}

export function createAuth(deps: AuthDeps): AuthManager {
  function status(): AuthStatus {
    const s = loadSession();
    return s ? { signedIn: true, email: decodeSub(s.token) } : { signedIn: false };
  }

  return {
    status,

    async login(): Promise<AuthStatus> {
      if (!deps.googleLoginClientId) {
        throw new Error("Google 로그인 클라이언트가 설정되지 않았습니다");
      }
      const { idToken, email } = await runGoogleLogin({
        clientId: deps.googleLoginClientId,
        clientSecret: deps.googleLoginClientSecret,
      });
      const resp = await fetch(`${deps.gatewayHttpUrl}/auth/google`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!resp.ok) {
        let reason = `${resp.status}`;
        try {
          const j = (await resp.json()) as { error?: string };
          if (j.error) reason = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(resp.status === 403 ? "허용된 사용자가 아닙니다" : `로그인 실패: ${reason}`);
      }
      const data = (await resp.json()) as { session_token?: string };
      if (!data.session_token) throw new Error("세션 토큰을 받지 못했습니다");
      saveSession(data.session_token);
      deps.onAuthenticated(data.session_token);
      return { signedIn: true, email };
    },

    async logout(): Promise<void> {
      clearSession();
      deps.onLoggedOut();
    },
  };
}
