import { app, BrowserWindow, ipcMain, screen, shell, systemPreferences } from "electron";
import path from "node:path";

import { CoreSupervisor } from "./core/supervisor";

// 드래그 세션: AvatarShell이 드래그 임계값 초과 시점에 windowStartDragging을 호출,
// Main이 cursor 좌표를 폴링하면서 win.setPosition으로 추적. mouseup 시점에 windowStopDragging.
// Electron은 Tauri의 startDragging 같은 OS 위임 API가 없어서 이렇게 폴링한다.
const DRAG_TICK_MS = 8; // ~120fps. 60Hz 모니터에서도 자연스러움
const DRAG_SAFETY_MS = 5_000; // Renderer가 stop 신호를 못 보낼 경우 안전 종료
let dragInterval: NodeJS.Timeout | null = null;
let dragSafetyTimer: NodeJS.Timeout | null = null;

function stopDragInternal(): void {
  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }
  if (dragSafetyTimer) {
    clearTimeout(dragSafetyTimer);
    dragSafetyTimer = null;
  }
}

// OAuth 외부 브라우저 위임 시 허용할 호스트 목록.
// Core가 emit한 url의 hostname이 이 목록에 있을 때만 `shell.openExternal` 호출.
const OAUTH_HOST_ALLOWLIST = new Set<string>([
  "accounts.google.com",
  "oauth2.googleapis.com",
]);

// 사용자 결정사항: legacy Tauri 데이터 경로를 명시적으로 고정.
function applyLegacyDataDir(): string {
  const platform = process.platform;
  const home = app.getPath("home");
  let legacy: string;
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    legacy = path.join(appData, "dev.ohmyhong.personalassistant");
  } else if (platform === "darwin") {
    legacy = path.join(home, "Library", "Application Support", "dev.ohmyhong.personalassistant");
  } else {
    const xdg = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
    legacy = path.join(xdg, "dev.ohmyhong.personalassistant");
  }
  app.setPath("userData", legacy);
  return legacy;
}

let mainWindow: BrowserWindow | null = null;
let core: CoreSupervisor | null = null;

// 위젯 레이아웃 상수 (logical px). Renderer의 CSS 레이아웃과 1:1 일치.
// 닫힘: 144x144 = 아바타 그 자체. 열림: 360x488 = panel(416) + 아바타 lower half(72).
// 아바타는 항상 윈도우 좌하단에 위치하며, 윈도우의 좌하단 좌표를 anchor로 고정한다.
const AVATAR_SIZE = 144;
const PANEL_FULL_W = 360;
const PANEL_OPEN_H = 488; // panel 416 + 아바타 lower half 72

interface PanelState {
  open: boolean;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: false,
    backgroundColor: "#00000000",
    center: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");

  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:1420";
  if (!app.isPackaged) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../../renderer/dist/index.html"));
  }

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  return win;
}

function broadcast(eventName: string, data: unknown): void {
  const channel = `event:${eventName}`;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  }
}

function handleShellOpenExternal(data: unknown): void {
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

function registerIpc(): void {
  // Bootstrap echo (EM0)
  ipcMain.handle("echo", (_e, payload: unknown) => payload);

  // Core forward 헬퍼
  const forward = (channel: string, method: string) => {
    ipcMain.handle(channel, async (_e, payload: unknown) => {
      if (!core) throw new Error("core not started");
      return core.request(method, payload ?? null);
    });
  };

  // EM1: app.health
  forward("appHealth", "app.health");

  // EM2: secrets / dailyCap / settings
  ipcMain.handle("setSecret", async (_e, payload: { slot: string; value: string }) => {
    if (!core) throw new Error("core not started");
    if (!payload || typeof payload.value !== "string" || payload.value.length === 0) {
      throw new Error("invalid secret payload");
    }
    return core.request("secret.set", payload);
  });
  ipcMain.handle("deleteSecret", async (_e, payload: { slot: string }) => {
    if (!core) throw new Error("core not started");
    return core.request("secret.delete", payload);
  });
  ipcMain.handle("secretStatus", async (_e, payload: { slot: string }) => {
    if (!core) throw new Error("core not started");
    return core.request("secret.status", payload);
  });
  forward("secretStatusAll", "secret.statusAll");

  forward("dailyCapGet", "settings.dailyCapGet");
  ipcMain.handle("dailyCapSet", async (_e, payload: { value: number }) => {
    if (!core) throw new Error("core not started");
    return core.request("settings.dailyCapSet", payload);
  });
  ipcMain.handle("settingsGet", async (_e, payload: { key: string }) => {
    if (!core) throw new Error("core not started");
    return core.request("settings.get", payload);
  });
  ipcMain.handle("settingsSet", async (_e, payload: { key: string; value: string }) => {
    if (!core) throw new Error("core not started");
    return core.request("settings.set", payload);
  });

  // EM3: chat / todos / cost
  ipcMain.handle(
    "chatSend",
    async (
      _e,
      payload: { user_message: string; conversation_id?: string },
    ) => {
      if (!core) throw new Error("core not started");
      return core.request("chat.send", payload);
    },
  );
  ipcMain.handle(
    "chatHistory",
    async (
      _e,
      payload: { conversation_id?: string; limit?: number },
    ) => {
      if (!core) throw new Error("core not started");
      return core.request("chat.history", payload ?? {});
    },
  );
  ipcMain.handle("chatClear", async (_e, payload: { conversation_id?: string }) => {
    if (!core) throw new Error("core not started");
    return core.request("chat.clear", payload ?? {});
  });
  forward("costSummary", "chat.costSummary");

  ipcMain.handle("todosList", async (_e, payload: { include_done?: boolean }) => {
    if (!core) throw new Error("core not started");
    return core.request("todos.list", payload ?? {});
  });
  ipcMain.handle("todosCreate", async (_e, payload: { draft: unknown }) => {
    if (!core) throw new Error("core not started");
    return core.request("todos.create", payload);
  });
  ipcMain.handle("todosComplete", async (_e, payload: { id: number }) => {
    if (!core) throw new Error("core not started");
    return core.request("todos.complete", payload);
  });
  ipcMain.handle("todosUncomplete", async (_e, payload: { id: number }) => {
    if (!core) throw new Error("core not started");
    return core.request("todos.uncomplete", payload);
  });
  ipcMain.handle("todosDelete", async (_e, payload: { id: number }) => {
    if (!core) throw new Error("core not started");
    return core.request("todos.delete", payload);
  });

  // EM4: OAuth / Calendar / Briefing
  forward("oauthGoogleStart", "oauth.googleStart");
  forward("oauthGoogleStatus", "oauth.googleStatus");
  forward("oauthGoogleDisconnect", "oauth.googleDisconnect");

  forward("calendarTodayEvents", "calendar.today");
  ipcMain.handle("calendarUpcomingEvents", async (_e, payload: { days?: number }) => {
    if (!core) throw new Error("core not started");
    return core.request("calendar.upcoming", payload ?? {});
  });
  forward("calendarSyncNow", "calendar.syncNow");
  ipcMain.handle("calendarCreateEvent", async (_e, payload: { draft: unknown }) => {
    if (!core) throw new Error("core not started");
    return core.request("calendar.create", payload);
  });
  ipcMain.handle("calendarDeleteEvent", async (_e, payload: { google_event_id: string }) => {
    if (!core) throw new Error("core not started");
    return core.request("calendar.delete", payload);
  });

  forward("briefingToday", "briefing.today");
  ipcMain.handle("briefingRun", async (_e, payload: { force?: boolean }) => {
    if (!core) throw new Error("core not started");
    return core.request("briefing.run", payload ?? {});
  });

  // EM5: Speech (STT/TTS)
  ipcMain.handle(
    "sttTranscribe",
    async (_e, payload: { audio_b64: string; mime?: string }) => {
      if (!core) throw new Error("core not started");
      if (process.platform === "darwin") {
        // macOS는 마이크 권한 명시적 요청. 이미 거부된 상태라면 사용자 알림이 필요하지만
        // 1.0 시점에는 askForMediaAccess만 호출하고 결과는 무시(Whisper 호출은 어차피 실패함).
        try {
          await systemPreferences.askForMediaAccess("microphone");
        } catch (e) {
          console.warn("[mic] askForMediaAccess failed", e);
        }
      }
      return core.request("speech.transcribe", payload);
    },
  );
  ipcMain.handle(
    "ttsSpeak",
    async (_e, payload: { text: string; voice?: string }) => {
      if (!core) throw new Error("core not started");
      return core.request("speech.speak", payload);
    },
  );

  // Window 제어
  ipcMain.handle("windowMinimize", () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });
  ipcMain.handle("windowClose", () => {
    BrowserWindow.getFocusedWindow()?.close();
  });

  // EM6: 패널 열림/닫힘에 따라 윈도우를 144→360x560 사이로 리사이즈. 아바타의 화면 위치는 유지.
  // hit-region 자체가 불필요해진다 (투명 영역이 0).
  ipcMain.handle(
    "windowApplyPanelState",
    (_e, next: PanelState) => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) return;
      const [curX, curY] = win.getPosition();
      const [, curH] = win.getSize();
      // anchor: 윈도우 좌하단 좌표 (= 아바타 좌하단 좌표). open/closed 모두 동일.
      const bottomLeftX = curX;
      const bottomLeftY = curY + curH;
      const newW = next.open ? PANEL_FULL_W : AVATAR_SIZE;
      const newH = next.open ? PANEL_OPEN_H : AVATAR_SIZE;
      const newX = bottomLeftX;
      const newY = bottomLeftY - newH;
      // setBounds로 size+position을 원자적으로 변경.
      win.setBounds({ x: newX, y: newY, width: newW, height: newH });
    },
  );

  ipcMain.handle("windowStartDragging", (e) => {
    const win =
      BrowserWindow.fromWebContents(e.sender) ?? mainWindow ?? null;
    if (!win || win.isDestroyed()) {
      console.warn("[drag] start: no window");
      return;
    }
    stopDragInternal();

    const cursor0 = screen.getCursorScreenPoint();
    const [winX0, winY0] = win.getPosition();
    const offsetX = cursor0.x - winX0;
    const offsetY = cursor0.y - winY0;
    console.info("[drag] start", { cursor0, winX0, winY0, offsetX, offsetY });

    dragInterval = setInterval(() => {
      if (win.isDestroyed()) {
        stopDragInternal();
        return;
      }
      const c = screen.getCursorScreenPoint();
      win.setPosition(c.x - offsetX, c.y - offsetY, false);
    }, DRAG_TICK_MS);

    dragSafetyTimer = setTimeout(() => {
      console.warn("[drag] safety timeout — Renderer가 stop 신호를 보내지 않음");
      stopDragInternal();
    }, DRAG_SAFETY_MS);
  });
  ipcMain.handle("windowStopDragging", () => {
    console.info("[drag] stop");
    stopDragInternal();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const dataDir = applyLegacyDataDir();

  app.whenReady().then(() => {
    registerIpc();

    core = new CoreSupervisor({
      dataDir,
      onEvent: (name, data) => {
        console.info("[core event]", name);
        if (name === "shell.openExternal") {
          handleShellOpenExternal(data);
          return; // Renderer에 노출하지 않음
        }
        broadcast(name, data);
      },
      onCrash: (reason, willRestart, attempt) => {
        broadcast("core.crashed", { reason, willRestart, attempt });
      },
    });
    core.start();

    mainWindow = createMainWindow();

    app.on("second-instance", () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on("before-quit", async (e) => {
    if (core) {
      e.preventDefault();
      const c = core;
      core = null;
      await c.shutdown().catch(() => undefined);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
