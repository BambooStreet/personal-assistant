import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import fs from "node:fs";
import path from "node:path";

import { CoreSupervisor } from "./core/supervisor";

// 드래그 세션을 윈도우별로 추적. AvatarShell/Panel 헤더가 각각 windowStartDragging IPC를
// 호출하면 해당 호출을 보낸 BrowserWindow를 식별해 그 윈도우만 cursor를 따라 이동.
const DRAG_TICK_MS = 8;
const DRAG_SAFETY_MS = 5_000;
interface DragSession {
  interval: NodeJS.Timeout;
  safety: NodeJS.Timeout;
}
const dragSessions = new Map<number, DragSession>();

function stopDragForWindow(winId: number): void {
  const s = dragSessions.get(winId);
  if (s) {
    clearInterval(s.interval);
    clearTimeout(s.safety);
    dragSessions.delete(winId);
  }
}

const OAUTH_HOST_ALLOWLIST = new Set<string>([
  "accounts.google.com",
  "oauth2.googleapis.com",
]);

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

let avatarWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let core: CoreSupervisor | null = null;
let isQuitting = false;

const AVATAR_W = 144;
const AVATAR_H = 144;
const PANEL_W = 360;
const PANEL_H = 416;

// 처음 panel을 show할 때만 avatar 위에 띄우고, 이후엔 사용자가 드래그한 위치를 기억.
// 메모리만 (재시작 시 휘발).
let lastPanelPos: { x: number; y: number } | null = null;
let panelHasBeenShown = false;

// avatar 위치를 userData에 JSON으로 저장. panel은 결정대로 메모리만.
function avatarStateFile(): string {
  return path.join(app.getPath("userData"), "avatar-window-state.json");
}

function loadAvatarPos(): { x: number; y: number } | null {
  try {
    const raw = fs.readFileSync(avatarStateFile(), "utf-8");
    const obj = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof obj.x !== "number" || typeof obj.y !== "number") return null;
    const px = obj.x;
    const py = obj.y;
    // 저장된 좌표가 어떤 디스플레이에도 속하지 않으면 무효 (모니터 분리 등).
    const isInside = screen.getAllDisplays().some(
      (d) =>
        px >= d.bounds.x &&
        px < d.bounds.x + d.bounds.width &&
        py >= d.bounds.y &&
        py < d.bounds.y + d.bounds.height,
    );
    if (!isInside) return null;
    return { x: px, y: py };
  } catch {
    return null;
  }
}

function saveAvatarPos(): void {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (!avatarWindow.isVisible()) return;
  const [x, y] = avatarWindow.getPosition();
  try {
    fs.writeFileSync(avatarStateFile(), JSON.stringify({ x, y }));
  } catch (e) {
    console.warn("[window-state] save failed", e);
  }
}

let avatarSaveTimer: NodeJS.Timeout | null = null;
function debouncedSaveAvatarPos(): void {
  if (avatarSaveTimer) clearTimeout(avatarSaveTimer);
  avatarSaveTimer = setTimeout(saveAvatarPos, 500);
}

function loadRenderer(win: BrowserWindow, which: "avatar" | "panel"): void {
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:1420";
  if (!app.isPackaged) {
    void win.loadURL(`${devUrl}/?w=${which}`);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../../renderer/dist/index.html"), {
      query: { w: which },
    });
  }
}

function createAvatarWindow(): BrowserWindow {
  const savedPos = loadAvatarPos();
  const win = new BrowserWindow({
    width: AVATAR_W,
    height: AVATAR_H,
    x: savedPos?.x,
    y: savedPos?.y,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: false,
    backgroundColor: "#00000000",
    center: !savedPos, // 저장된 좌표가 없으면 center로
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
  loadRenderer(win, "avatar");
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  // 사용자 드래그로 위치가 바뀌면 디바운스 저장.
  win.on("move", debouncedSaveAvatarPos);
  // Alt+F4 등으로 avatar를 close 시도하면 hide로 가로챔 (tray의 Quit만 실제 종료).
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
      hidePanel();
    }
  });
  win.on("closed", () => {
    avatarWindow = null;
  });
  return win;
}

function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    show: false,
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
  loadRenderer(win, "panel");
  win.setIgnoreMouseEvents(true, { forward: true });

  // 사용자가 OS-level close (Alt+F4)를 눌러도 hide만.
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      hidePanel();
    }
  });

  return win;
}

function savePanelPos(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  if (panelWindow.isVisible()) {
    const [x, y] = panelWindow.getPosition();
    lastPanelPos = { x, y };
  }
}

// avatar 위에 panel을 배치. avatar 좌상단을 기준으로 panel.bottom = avatar.top - 8 정도(살짝 띄움).
function positionPanelAboveAvatar(): { x: number; y: number } {
  if (!avatarWindow || avatarWindow.isDestroyed()) {
    return { x: 100, y: 100 };
  }
  const [ax, ay] = avatarWindow.getPosition();
  const x = ax + Math.round((AVATAR_W - PANEL_W) / 2); // panel을 avatar 가운데 정렬
  const y = ay - PANEL_H - 8;
  return { x, y };
}

function broadcast(eventName: string, data: unknown): void {
  const channel = `event:${eventName}`;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  }
}

function showAvatar(): void {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (!avatarWindow.isVisible()) avatarWindow.show();
  avatarWindow.focus();
}

function hideAvatar(): void {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (avatarWindow.isVisible()) avatarWindow.hide();
  hidePanel();
}

function createTray(): Tray {
  const iconPath =
    process.platform === "win32"
      ? path.join(__dirname, "..", "resources", "tray.ico")
      : path.join(__dirname, "..", "resources", "tray.png");
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin") icon.setTemplateImage(true);

  const t = new Tray(icon);
  t.setToolTip("Personal Assistant");

  const buildMenu = () => {
    const visible = !!avatarWindow && avatarWindow.isVisible();
    return Menu.buildFromTemplate([
      {
        label: visible ? "아바타 숨기기" : "아바타 보이기",
        click: () => {
          if (visible) hideAvatar();
          else showAvatar();
          t.setContextMenu(buildMenu());
        },
      },
      {
        label: "패널 열기",
        click: () => {
          showAvatar();
          showPanel();
        },
      },
      {
        label: "설정",
        click: () => {
          showAvatar();
          broadcast("panel.openSettings", null);
          showPanel();
        },
      },
      { type: "separator" },
      {
        label: "종료",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
  };

  t.setContextMenu(buildMenu());

  // Windows: 트레이 아이콘 클릭 = 아바타 토글
  t.on("click", () => {
    if (avatarWindow?.isVisible()) hideAvatar();
    else showAvatar();
    t.setContextMenu(buildMenu());
  });

  return t;
}

function showPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  let target: { x: number; y: number };
  if (!panelHasBeenShown) {
    target = positionPanelAboveAvatar();
    panelHasBeenShown = true;
  } else {
    target = lastPanelPos ?? positionPanelAboveAvatar();
  }
  panelWindow.setPosition(target.x, target.y);
  panelWindow.setOpacity(0);
  panelWindow.show();
  // 렌더러가 합성될 시간을 준 뒤 opacity를 올려 플리커 방지.
  setTimeout(() => {
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.setOpacity(1);
    }
  }, 30);
  broadcast("panel.openChanged", { open: true });
}

function hidePanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  savePanelPos();
  panelWindow.hide();
  broadcast("panel.openChanged", { open: false });
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
  ipcMain.handle("echo", (_e, payload: unknown) => payload);

  const forward = (channel: string, method: string) => {
    ipcMain.handle(channel, async (_e, payload: unknown) => {
      if (!core) throw new Error("core not started");
      return core.request(method, payload ?? null);
    });
  };

  forward("appHealth", "app.health");

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

  ipcMain.handle("chatSend", async (e, payload: { user_message: string; conversation_id?: string }) => {
    if (!core) throw new Error("core not started");
    const result = await core.request("chat.send", payload);
    // 호출한 윈도우 외 다른 윈도우의 store가 자기 chat 상태를 갱신하도록 fan-out.
    // 호출자(panel)가 본인이면 이미 send()가 store를 업데이트하므로 자기 자신은 제외.
    const senderId = e.sender.id;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      if (w.webContents.id === senderId) continue;
      w.webContents.send("event:chat.turnAdded", {
        user_message: payload.user_message,
        turn: result,
      });
    }
    return result;
  });
  ipcMain.handle("chatHistory", async (_e, payload: { conversation_id?: string; limit?: number }) => {
    if (!core) throw new Error("core not started");
    return core.request("chat.history", payload ?? {});
  });
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

  ipcMain.handle("sttTranscribe", async (_e, payload: { audio_b64: string; mime?: string }) => {
    if (!core) throw new Error("core not started");
    if (process.platform === "darwin") {
      try {
        await systemPreferences.askForMediaAccess("microphone");
      } catch (e) {
        console.warn("[mic] askForMediaAccess failed", e);
      }
    }
    return core.request("speech.transcribe", payload);
  });
  ipcMain.handle("ttsSpeak", async (_e, payload: { text: string; voice?: string }) => {
    if (!core) throw new Error("core not started");
    return core.request("speech.speak", payload);
  });

  // Window 제어 — sender의 윈도우 기준
  ipcMain.handle("windowMinimize", (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.handle("windowClose", (e) => {
    // 기본은 sender 닫기. 단 panelWindow는 close 이벤트에서 hide로 가로챔 → panel 닫기 버튼은 setPanelOpen(false) 사용 권장.
    BrowserWindow.fromWebContents(e.sender)?.close();
  });

  // sender 윈도우만 click-through 토글
  ipcMain.handle("windowSetClickThrough", (e, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // 패널 표시/숨김. avatarWindow와 panelWindow 양쪽 Renderer에 panel.openChanged 이벤트 broadcast.
  ipcMain.handle("windowSetPanelOpen", (_e, open: boolean) => {
    if (open) showPanel();
    else hidePanel();
  });

  // 아바타 상태(idle/listening/thinking/speaking) 동기화. ChatPanel/MicButton/BriefingCard가
  // panelWindow에서 set하면 avatarWindow의 표정도 따라 바뀐다.
  ipcMain.handle("windowSetAvatarState", (_e, state: string) => {
    broadcast("avatar.stateChanged", { state });
  });

  // 범용 broadcast — renderer가 다른 윈도우에 이벤트를 보낼 때 사용.
  ipcMain.handle("windowBroadcast", (_e, payload: { event: string; data: unknown }) => {
    broadcast(payload.event, payload.data);
  });

  // 자동 시작. setLoginItemSettings는 Windows/macOS 지원, Linux는 no-op.
  ipcMain.handle("autoLaunchGet", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("autoLaunchSet", (_e, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: false, // 시작 시 위젯 표시 (avatar 작아서 방해 적음)
    });
  });

  ipcMain.handle("windowStartDragging", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) {
      console.warn("[drag] start: no window");
      return;
    }
    const winId = win.id;
    stopDragForWindow(winId);

    const cursor0 = screen.getCursorScreenPoint();
    const [winX0, winY0] = win.getPosition();
    const offsetX = cursor0.x - winX0;
    const offsetY = cursor0.y - winY0;

    const interval = setInterval(() => {
      if (win.isDestroyed()) {
        stopDragForWindow(winId);
        return;
      }
      const c = screen.getCursorScreenPoint();
      win.setPosition(c.x - offsetX, c.y - offsetY, false);
    }, DRAG_TICK_MS);
    const safety = setTimeout(() => {
      console.warn("[drag] safety timeout — stop signal missing");
      stopDragForWindow(winId);
    }, DRAG_SAFETY_MS);
    dragSessions.set(winId, { interval, safety });
  });
  ipcMain.handle("windowStopDragging", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) stopDragForWindow(win.id);
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
          return;
        }
        broadcast(name, data);
      },
      onCrash: (reason, willRestart, attempt) => {
        broadcast("core.crashed", { reason, willRestart, attempt });
      },
    });
    core.start();

    avatarWindow = createAvatarWindow();
    panelWindow = createPanelWindow();
    tray = createTray();

    // 음성 사이클 트리거 단축키 (Phase B prototype). Phase C에서 wake-word 디텍터로 교체.
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
      if (!avatarWindow) return;
      if (avatarWindow.isMinimized()) avatarWindow.restore();
      avatarWindow.show();
      avatarWindow.focus();
    });

    app.on("activate", () => {
      if (!avatarWindow || avatarWindow.isDestroyed()) {
        avatarWindow = createAvatarWindow();
      }
      if (!panelWindow || panelWindow.isDestroyed()) {
        panelWindow = createPanelWindow();
      }
    });
  });

  app.on("before-quit", async (e) => {
    saveAvatarPos();
    globalShortcut.unregisterAll();
    if (core) {
      e.preventDefault();
      isQuitting = true;
      const c = core;
      core = null;
      await c.shutdown().catch(() => undefined);
      if (tray) {
        tray.destroy();
        tray = null;
      }
      app.quit();
    } else {
      isQuitting = true;
      if (tray) {
        tray.destroy();
        tray = null;
      }
    }
  });

  // tray가 살아 있는 한 windows 모두 hidden 상태에서도 앱은 유지된다.
  // (Windows/Linux 기본 동작: window-all-closed → quit. tray 있으니 무시)
  app.on("window-all-closed", () => {
    // no-op: tray가 종료를 책임진다
  });
}
