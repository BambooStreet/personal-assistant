// 빌드 후 처리: 컴파일된 main dist에 Google Desktop client_secret을 주입한다.
// 소스(cloud.config.ts)에는 placeholder("__PA_CLIENT_SECRET__")만 두고 실제 secret은
// 커밋하지 않는다(CLAUDE.md: secrets 커밋 금지). 로컬 패키징은 셸 env, CI는 GitHub Actions
// secret으로 PA_GOOGLE_LOGIN_CLIENT_SECRET을 주입한다.
//
// env가 없으면(예: 기여자 로컬 빌드) 경고만 하고 통과 — 그 빌드는 로그인 불가하지만
// dev(`npm run dev`)는 런타임 env로 동작하므로 개발엔 지장 없다.
//
// runtime이 process.env를 먼저 읽으므로, 이 주입은 "패키징된 앱(사용자 PC엔 env 없음)"을
// 위한 것이다. build:main 뒤에 실행된다(package.json).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const QUOTED_PLACEHOLDER = '"__PA_CLIENT_SECRET__"';
const target = resolve("apps/main/dist/config/cloud.config.js");
const secret = process.env.PA_GOOGLE_LOGIN_CLIENT_SECRET?.trim();

if (!secret) {
  console.warn(
    "[inject-secret] PA_GOOGLE_LOGIN_CLIENT_SECRET 미설정 — placeholder 유지. " +
      "패키징 빌드는 Google 로그인 불가(dev는 런타임 env로 동작).",
  );
  process.exit(0);
}

let js;
try {
  js = readFileSync(target, "utf8");
} catch {
  console.error(`[inject-secret] 대상 없음: ${target} — build:main을 먼저 실행하세요.`);
  process.exit(1);
}

if (!js.includes(QUOTED_PLACEHOLDER)) {
  console.warn(
    `[inject-secret] placeholder(${QUOTED_PLACEHOLDER}) 없음 — 이미 주입됐거나 소스 형식이 바뀜. 건너뜀.`,
  );
  process.exit(0);
}

// JSON.stringify로 따옴표/이스케이프 안전하게 치환(placeholder는 큰따옴표 포함해 통째로 교체).
const injected = js.split(QUOTED_PLACEHOLDER).join(JSON.stringify(secret));
writeFileSync(target, injected);
console.log("[inject-secret] client_secret 주입 완료 (값 비표시).");
