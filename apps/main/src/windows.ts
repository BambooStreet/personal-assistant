import { app, BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";

import { state } from "./state";

// 두 윈도우(아바타/패널)와 그 위치 영속화/show-hide/broadcast를 담당.
// 다른 모듈은 getAvatarWindow/getPanelWindow getter를 통해 접근하고,
// 직접 BrowserWindow 인스턴스를 보존하지 않는다.

const AVATAR_W = 200;
const AVATAR_H = 200;
const PANEL_W = 360;
const PANEL_H = 416;

let avatarWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;

// 처음 panel을 show할 때만 avatar 위에 띄우고, 이후엔 사용자가 마지막에 두었던 곳을 기억.
// 좌표를 절대값이 아닌 "아바타 기준 상대 오프셋"으로 저장해서 두 경우를 자연스럽게 처리:
//   - 사용자가 패널을 드래그 → 오프셋 갱신 → 다음 등장 시 그 위치
//   - 사용자가 아바타를 드래그 → 오프셋 유지 → 패널이 아바타 따라 같은 상대 위치로 등장
// 메모리만 (재시작 시 휘발).
let lastPanelOffset: { dx: number; dy: number } | null = null;

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
  // setIgnoreMouseEvents 안 부름 — -webkit-app-region: drag이 mousedown 시점에 동기적으로
  // 잡혀야 하는데 forward 모드 + 비동기 토글로는 race가 발생함. 윈도우 전체가 마우스를 캡처.
  // move 이벤트는 (1) 위치 디바운스 저장 + (2) avatar.moved broadcast로 렌더러의 long-press
  // dragMode 종료 타이머 리셋을 트리거.
  win.on("move", () => {
    debouncedSaveAvatarPos();
    broadcast("avatar.moved", null);
  });
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

function savePanelOffset(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (!panelWindow.isVisible()) return;
  const [px, py] = panelWindow.getPosition();
  const [ax, ay] = avatarWindow.getPosition();
  lastPanelOffset = { dx: px - ax, dy: py - ay };
}

// 아바타 윈도우 top에서 8px 위에 panel을 배치. 가로는 아바타 가운데 정렬.
function positionPanelAboveAvatar(): { x: number; y: number } {
  if (!avatarWindow || avatarWindow.isDestroyed()) {
    return { x: 100, y: 100 };
  }
  const [ax, ay] = avatarWindow.getPosition();
  const x = ax + Math.round((AVATAR_W - PANEL_W) / 2);
  const y = ay - PANEL_H - 8;
  return { x, y };
}

// 패널 상단(드래그 핸들)이 화면 위로 잘리면 사용자가 더 이상 드래그로 옮길 수 없게 된다.
// 그래서 y는 panel이 위치할 디스플레이의 workArea.y 이상으로 강제.
// 좌우는 일부 잘려도 헤더가 가로 전체이므로 잡기 가능 → top만 클램프.
function clampPanelTop(x: number, y: number): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint({ x, y });
  return { x, y: Math.max(y, display.workArea.y) };
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
  if (!lastPanelOffset || !avatarWindow || avatarWindow.isDestroyed()) {
    target = positionPanelAboveAvatar();
  } else {
    const [ax, ay] = avatarWindow.getPosition();
    target = { x: ax + lastPanelOffset.dx, y: ay + lastPanelOffset.dy };
  }
  target = clampPanelTop(target.x, target.y);
  // setPosition + show 대신 setBounds로 너비/높이를 매번 재선언 — Win11 + 분수 DPI
  // 스케일링에서 transparent frameless 윈도우가 show마다 1-2px 다르게 잡히는 현상 방지.
  panelWindow.setBounds({
    x: target.x,
    y: target.y,
    width: PANEL_W,
    height: PANEL_H,
  });
  panelWindow.show();
  // 렌더러가 panel-card-hidden 초기 상태로 들어가 있다가 broadcast를 받으면
  // CSS keyframe으로 페이드 + slide-up 등장 — 윈도우 단의 opacity dance 불필요.
  broadcast("panel.openChanged", { open: true });
}

export function hidePanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  savePanelOffset();
  panelWindow.hide();
  broadcast("panel.openChanged", { open: false });
}
