import { app, globalShortcut } from "electron";
import path from "node:path";

import { CoreSupervisor } from "./core/supervisor";
import { closeAllDebugStreams } from "./debug-log";
import { registerIpc } from "./ipc";
import { handleShellOpenExternal } from "./oauth-shell";
import { state } from "./state";
import { createTray, destroyTray } from "./tray";
import {
  broadcast,
  createAvatarWindow,
  createPanelWindow,
  getAvatarWindow,
  getPanelWindow,
  saveAvatarPos,
} from "./windows";

// Tauri 시절 userData 경로(`dev.ohmyhong.personalassistant`)를 그대로 재사용해 기존 사용자
// 데이터(설정/DB)를 마이그레이션 없이 이어 받는다.
function applyLegacyDataDir(): string {
  const platform = process.platform;
  const home = app.getPath("home");
  let legacy: string;
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    legacy = path.join(appData, "dev.ohmyhong.personalassistant");
  } else if (platform === "darwin") {
    legacy = path.join(
      home,
      "Library",
      "Application Support",
      "dev.ohmyhong.personalassistant",
    );
  } else {
    const xdg = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
    legacy = path.join(xdg, "dev.ohmyhong.personalassistant");
  }
  app.setPath("userData", legacy);
  return legacy;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const dataDir = applyLegacyDataDir();

  app.whenReady().then(() => {
    registerIpc();

    state.core = new CoreSupervisor({
      dataDir,
      onEvent: (name, data) => {
        console.info("[core event]", name);
        if (name === "shell.openExternal") {
          handleShellOpenExternal(data);
          return;
        }
        broadcast(name, data);
      },
      onCrash: (reason, willRestart, attempt) => {
        broadcast("core.crashed", { reason, willRestart, attempt });
      },
    });
    state.core.start();

    createAvatarWindow();
    createPanelWindow();
    createTray();

    // 음성 사이클 트리거 단축키 (Phase B prototype). Phase C-2부터 wake-word 디텍터와 병용.
    const wakeAccelerator = "CommandOrControl+Shift+Space";
    const ok = globalShortcut.register(wakeAccelerator, () => {
      console.info("[voice] wake shortcut triggered");
      broadcast("voice.wake", null);
    });
    if (!ok) {
      console.warn(
        `[voice] failed to register shortcut ${wakeAccelerator} (이미 사용 중)`,
      );
    }

    app.on("second-instance", () => {
      const av = getAvatarWindow();
      if (!av) return;
      if (av.isMinimized()) av.restore();
      av.show();
      av.focus();
    });

    app.on("activate", () => {
      const av = getAvatarWindow();
      if (!av || av.isDestroyed()) createAvatarWindow();
      const pn = getPanelWindow();
      if (!pn || pn.isDestroyed()) createPanelWindow();
    });
  });

  app.on("before-quit", async (e) => {
    saveAvatarPos();
    globalShortcut.unregisterAll();
    closeAllDebugStreams();
    if (state.core) {
      e.preventDefault();
      state.isQuitting = true;
      const c = state.core;
      state.core = null;
      await c.shutdown().catch(() => undefined);
      destroyTray();
      app.quit();
    } else {
      state.isQuitting = true;
      destroyTray();
    }
  });

  // tray가 살아 있는 한 windows 모두 hidden 상태에서도 앱은 유지된다.
  // (Windows/Linux 기본: window-all-closed → quit. tray 있으니 무시)
  app.on("window-all-closed", () => {
    // no-op: tray가 종료를 책임진다
  });
}
