// @pa/cloud-bot — 클라우드에서 pa-core(Linux)를 띄우고 텔레그램으로 중계.
// long-polling이라 인바운드 포트가 필요 없다(PC off에서도 동작). 모든 연결이 아웃바운드.

import { Bot } from "grammy";
import { CoreSupervisor } from "@pa/core-rpc";

import { makeAuthenticator } from "./auth";
import { loadConfig } from "./config";
import { formatNotification } from "./format";
import { startGateway, type GatewayHandle } from "./gateway";
import { registerHandlers } from "./handlers";
import type { NotificationFired } from "./types";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = new Bot(config.botToken);

  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });
  // 게이트웨이는 Core 생성 후 시작되지만 onEvent에서 참조하므로 가변 홀더로.
  let gateway: GatewayHandle | null = null;

  const core = new CoreSupervisor({
    corePath: config.corePath,
    dataDir: config.dataDir,
    onEvent: (name, data) => {
      if (name === "core.ready") {
        resolveReady();
      } else if (name === "notification.fired") {
        // v0: 단일 오너(user_id=1) → 오너 chat으로 전송.
        const n = data as NotificationFired;
        bot.api
          .sendMessage(config.ownerChatId, formatNotification(n))
          .catch((e) => console.error("[bot] 알림 전송 실패:", e));
      }
      // 모든 이벤트를 WS 클라이언트(데스크톱)에도 팬아웃.
      gateway?.broadcast(name, data);
    },
    onCrash: (reason, willRestart, attempt) => {
      console.error(
        `[bot] core 비정상 종료: ${reason} (재시작=${willRestart}, 시도=${attempt})`,
      );
    },
  });

  registerHandlers(bot, core, config);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info("[bot] 종료 중…");
    await bot.stop().catch(() => {});
    await core.shutdown().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  core.start();

  // 데스크톱 접속용 WS 게이트웨이 기동(같은 Core 공유).
  // Google 로그인 인증(세션 JWT) 또는 레거시 토큰 중 하나라도 설정돼 있으면 기동.
  const authenticator = makeAuthenticator(config);
  if (authenticator || config.gatewayToken) {
    gateway = startGateway(core, {
      port: config.gatewayPort,
      authenticator,
      legacyToken: config.gatewayToken,
    });
    console.info(
      `[bot] 게이트웨이 인증: ${authenticator ? "Google 로그인(세션 JWT)" : ""}${
        authenticator && config.gatewayToken ? " + " : ""
      }${config.gatewayToken ? "레거시 토큰" : ""}`,
    );
  }

  // Core 준비 대기. 타임아웃돼도 폴링은 시작하되, 첫 요청은 에러로 안내될 수 있음.
  await Promise.race([ready, delay(15_000)]);

  console.info("[bot] long-polling 시작");
  await bot.start();
}

main().catch((e) => {
  console.error("[bot] 치명적 오류:", e);
  process.exit(1);
});
