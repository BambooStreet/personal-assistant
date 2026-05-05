import { shell } from "electron";

// Core가 OAuth 동의 화면 URL을 emit하면 Main이 host allowlist 검증 후 외부 브라우저로 연다.
// 임의 URL을 통과시키지 않도록 https + 알려진 호스트만 허용.
const OAUTH_HOST_ALLOWLIST = new Set<string>([
  "accounts.google.com",
  "oauth2.googleapis.com",
]);

export function handleShellOpenExternal(data: unknown): void {
  const url =
    data && typeof data === "object" && "url" in (data as Record<string, unknown>)
      ? (data as { url?: unknown }).url
      : undefined;
  if (typeof url !== "string") {
    console.warn("[shell.openExternal] url 누락", data);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn("[shell.openExternal] invalid URL:", url);
    return;
  }
  if (parsed.protocol !== "https:") {
    console.warn("[shell.openExternal] non-https rejected:", parsed.protocol);
    return;
  }
  if (!OAUTH_HOST_ALLOWLIST.has(parsed.hostname)) {
    console.warn("[shell.openExternal] host not allowed:", parsed.hostname);
    return;
  }
  void shell.openExternal(parsed.toString());
}
