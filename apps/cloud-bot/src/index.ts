// @pa/cloud-bot — 클라우드에서 pa-core(Linux)를 띄우고 텔레그램으로 중계.
// long-polling이라 인바운드 포트가 필요 없다(PC off에서도 동작). 모든 연결이 아웃바운드.

import { Bot } from "grammy";
import { CoreSupervisor } from "@pa/core-rpc";

import { loadConfig } from "./config";
import { formatNotification } from "./format";
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

  const core = new CoreSupervisor({
    corePath: config.corePath,
    dataDir: config.dataDir,
    onEvent: (name, data) => {
      if (name === "core.ready") {
        resolveReady();
        return;
      }
      if (name === "notification.fired") {
        // v0: 단일 오너(user_id=1) → 오너 chat으로 전송.
        const n = data as NotificationFired;
        bot.api
          .sendMessage(config.ownerChatId, formatNotification(n))
          .catch((e) => console.error("[bot] 알림 전송 실패:", e));
      }
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
  // Core 준비 대기. 타임아웃돼도 폴링은 시작하되, 첫 요청은 에러로 안내될 수 있음.
  await Promise.race([ready, delay(15_000)]);

  console.info("[bot] long-polling 시작");
  await bot.start();
}

main().catch((e) => {
  console.error("[bot] 치명적 오류:", e);
  process.exit(1);
});
