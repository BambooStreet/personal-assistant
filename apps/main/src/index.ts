import { app, globalShortcut } from "electron";
import path from "node:path";

import { createAuth } from "./auth";
import { clearSession, loadSession } from "./auth/session-store";
import { resolveCloudConfig } from "./config/cloud.config";
import { RemoteCore } from "./core/remote-client";
import { CoreSupervisor } from "./core/supervisor";
import { closeAllDebugStreams } from "./debug-log";
import { registerIpc } from "./ipc";
import { showOsNotification } from "./notifications";
import { handleShellOpenExternal } from "./oauth-shell";
import { state } from "./state";
import { createTray, destroyTray } from "./tray";
import { initUpdater } from "./updater";
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

  // Windows 11에서 알림이 올바른 앱 아이콘과 함께 뜨도록 AppUserModelID 명시.
  // 패키징된 앱은 자동으로 잡히지만 dev 환경 대응을 위해 호출.
  if (process.platform === "win32") {
    app.setAppUserModelId("dev.ohmyhong.personalassistant");
  }

  app.whenReady().then(() => {
    registerIpc();

    // Core 이벤트/크래시 처리는 로컬·원격 모드 공통.
    const onEvent = (name: string, data: unknown) => {
      console.info("[core event]", name);
      if (name === "shell.openExternal") {
        handleShellOpenExternal(data);
        return;
      }
      if (name === "notification.fired") {
        showOsNotification(data);
        broadcast(name, data);
        return;
      }
      broadcast(name, data);
    };
    // 패키징 앱 = 클라우드(remote) 기본, dev = 로컬 기본(env로 override). env > BAKED > 기본.
    const cfg = resolveCloudConfig(app.isPackaged);

    if (cfg.coreMode === "remote") {
      // 원격 모드: Google 로그인으로 세션 JWT 확보 → 게이트웨이 WS 접속. 로컬 Core 미기동(단일 라이터).
      const onCrash = (reason: string, willRestart: boolean, attempt: number) => {
        broadcast("core.crashed", { reason, willRestart, attempt });
        if (reason === "unauthorized") {
          // 세션 만료/무효 → 재연결 말고 로그인 다시 요구.
          clearSession();
          void state.core?.shutdown();
          state.core = null;
          broadcast("auth.required", null);
        }
      };
      const connectRemote = (token: string) => {
        void state.core?.shutdown();
        state.core = new RemoteCore({ url: cfg.gatewayUrl, token, onEvent, onCrash });
        state.core.start();
      };
      state.auth = createAuth({
        gatewayHttpUrl: cfg.gatewayHttpUrl,
        googleLoginClientId: cfg.googleLoginClientId,
        googleLoginClientSecret: cfg.googleLoginClientSecret || undefined,
        onAuthenticated: (token) => connectRemote(token),
        onLoggedOut: () => {
          void state.core?.shutdown();
          state.core = null;
          broadcast("auth.required", null);
        },
      });
      const existing = loadSession();
      if (existing) {
        console.info("[core] remote 모드 — 저장된 세션으로 접속");
        connectRemote(existing.token);
      } else {
        console.info("[core] remote 모드 — 세션 없음, 로그인 대기");
        // core 미기동. 렌더러가 로그인 게이트 표시 후 auth.login → onAuthenticated에서 접속.
      }
    } else {
      // 로컬(dev): 로컬 Core spawn. auth는 null → 렌더러 로그인 게이트 통과(signed_in).
      const onCrash = (reason: string, willRestart: boolean, attempt: number) => {
        broadcast("core.crashed", { reason, willRestart, attempt });
      };
      state.core = new CoreSupervisor({ dataDir, onEvent, onCrash });
      state.core.start();
    }

    createAvatarWindow();
    createPanelWindow();
    createTray();

    // 자동 업데이트(패키징 빌드에서만 동작). 시작 시 1회 확인 + 이벤트 배선.
    initUpdater();

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
