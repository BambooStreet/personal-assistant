import { app, BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";

import { state } from "./state";

// 두 윈도우(아바타/패널)와 그 위치 영속화/show-hide/broadcast를 담당.
// 다른 모듈은 getAvatarWindow/getPanelWindow getter를 통해 접근하고,
// 직접 BrowserWindow 인스턴스를 보존하지 않는다.

const AVATAR_W = 144;
const AVATAR_H = 144;
const PANEL_W = 360;
const PANEL_H = 416;

let avatarWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;

// 처음 panel을 show할 때만 avatar 위에 띄우고, 이후엔 사용자가 드래그한 위치를 기억.
// 메모리만 (재시작 시 휘발).
let lastPanelPos: { x: number; y: number } | null = null;
let panelHasBeenShown = false;

let avatarSaveTimer: NodeJS.Timeout | null = null;

export const getAvatarWindow = (): BrowserWindow | null => avatarWindow;
export const getPanelWindow = (): BrowserWindow | null => panelWindow;

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

export function saveAvatarPos(): void {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (!avatarWindow.isVisible()) return;
  const [x, y] = avatarWindow.getPosition();
  try {
    fs.writeFileSync(avatarStateFile(), JSON.stringify({ x, y }));
  } catch (e) {
    console.warn("[window-state] save failed", e);
  }
}

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

export function createAvatarWindow(): BrowserWindow {
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
    if (!state.isQuitting) {
      e.preventDefault();
      win.hide();
      hidePanel();
    }
  });
  win.on("closed", () => {
    avatarWindow = null;
  });
  avatarWindow = win;
  return win;
}

export function createPanelWindow(): BrowserWindow {
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
    if (!state.isQuitting) {
      e.preventDefault();
      hidePanel();
    }
  });

  panelWindow = win;
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

export function broadcast(eventName: string, data: unknown): void {
  const channel = `event:${eventName}`;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  }
}

export function showAvatar(): void {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (!avatarWindow.isVisible()) avatarWindow.show();
  avatarWindow.focus();
}

export function hideAvatar(): void {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (avatarWindow.isVisible()) avatarWindow.hide();
  hidePanel();
}

export function showPanel(): void {
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

export function hidePanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  savePanelPos();
  panelWindow.hide();
  broadcast("panel.openChanged", { open: false });
}
