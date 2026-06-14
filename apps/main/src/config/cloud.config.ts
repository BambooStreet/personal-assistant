// 빌드 설정(커밋됨, 비밀 아님). 패키징된 "클라우드 빌드"가 env 없이도 원격 접속하도록.
// 우선순위: 환경변수 > BAKED > 기본. dev(`npm run dev`)는 기본 local, 패키징 앱은 기본 remote.
// PA_SESSION_SECRET 같은 진짜 비밀은 여기 두지 않는다(클라우드 전용).

export interface ResolvedCloudConfig {
  coreMode: "local" | "remote";
  gatewayUrl: string; // wss://...
  gatewayHttpUrl: string; // https://... (/auth/google)
  googleLoginClientId: string;
  googleLoginClientSecret: string; // Desktop-app 클라이언트 secret(공개 클라이언트라 비밀 아님)
}

// 출시 빌드 기본값. 오너가 본인 값으로 채워 커밋(클라이언트 id는 비밀 아님).
const BAKED = {
  gatewayUrl: "wss://personal-assistant-miya.fly.dev",
  gatewayHttpUrl: "https://personal-assistant-miya.fly.dev",
  googleLoginClientId: "", // TODO(오너): Google "Desktop app" OAuth client id 입력
  googleLoginClientSecret: "",
} as const;

export function resolveCloudConfig(isPackaged: boolean): ResolvedCloudConfig {
  const envMode = process.env.PA_CORE_MODE;
  const coreMode: "local" | "remote" =
    envMode === "remote" || envMode === "local"
      ? envMode
      : isPackaged
        ? "remote" // 패키징 앱 = 클라우드 모드 기본
        : "local"; // dev 기본 로컬

  return {
    coreMode,
    gatewayUrl: process.env.PA_GATEWAY_URL?.trim() || BAKED.gatewayUrl,
    gatewayHttpUrl: process.env.PA_GATEWAY_HTTP_URL?.trim() || BAKED.gatewayHttpUrl,
    googleLoginClientId:
      process.env.PA_GOOGLE_LOGIN_CLIENT_ID?.trim() || BAKED.googleLoginClientId,
    googleLoginClientSecret:
      process.env.PA_GOOGLE_LOGIN_CLIENT_SECRET?.trim() || BAKED.googleLoginClientSecret,
  };
}
