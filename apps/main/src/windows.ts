import { app, BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";

import { state } from "./state";

// 두 윈도우(아바타/패널)와 그 위치 영속화/show-hide/broadcast를 담당.
// 다른 모듈은 getAvatarWindow/getPanelWindow getter를 통해 접근하고,
// 직접 BrowserWindow 인스턴스를 보존하지 않는다.

const AVATAR_W = 200;
// 윈도우 하단 200px이 아바타 영역, 상단 80px이 미니 런처 영역 (hover로 표시).
// 상단은 평소 투명 + click-through 처리되므로 시각적/기능적 점유 없음.
const AVATAR_H = 280;
const AVATAR_ICON_H = 200;
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
  // setIgnoreMouseEvents 안 부름 — -webkit-app-region: drag이 mousedown 시점에 동기적으로
  // 잡혀야 하는데 forward 모드 + 비동기 토글로는 race가 발생함. 윈도우 전체가 마우스를 캡처.
  // 윈도우 상단 80px(런처 미표시 시 투명 영역)도 hit-zone에 포함되는 트레이드오프 있음.
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

// avatar 시각 위치 위에 panel을 배치. 윈도우 상단 80px이 launcher 영역이므로
// 아바타 시각 top = ay + (AVATAR_H - AVATAR_ICON_H). 그 위 8px 띄움.
function positionPanelAboveAvatar(): { x: number; y: number } {
  if (!avatarWindow || avatarWindow.isDestroyed()) {
    return { x: 100, y: 100 };
  }
  const [ax, ay] = avatarWindow.getPosition();
  const avatarVisualTop = ay + (AVATAR_H - AVATAR_ICON_H);
  const x = ax + Math.round((AVATAR_W - PANEL_W) / 2); // panel을 avatar 가운데 정렬
  const y = avatarVisualTop - PANEL_H - 8;
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

// 패널이 아바타 근처라고 인정할 거리(px). 이보다 멀어지면 아바타가 이동한 것으로
// 간주하고 다시 아바타 위로 재배치.
const PANEL_ANCHOR_TOLERANCE_PX = 300;

export function showPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  const aboveAvatar = positionPanelAboveAvatar();
  let target: { x: number; y: number };
  if (!panelHasBeenShown || !lastPanelPos) {
    target = aboveAvatar;
    panelHasBeenShown = true;
  } else {
    // lastPanelPos가 현재 아바타 기준 anchor에서 멀어졌으면 아바타를 따라간다.
    // (사용자가 아바타를 다른 위치로 드래그한 경우)
    const dx = Math.abs(lastPanelPos.x - aboveAvatar.x);
    const dy = Math.abs(lastPanelPos.y - aboveAvatar.y);
    const farFromAnchor =
      dx > PANEL_ANCHOR_TOLERANCE_PX || dy > PANEL_ANCHOR_TOLERANCE_PX;
    target = farFromAnchor ? aboveAvatar : lastPanelPos;
  }
  panelWindow.setPosition(target.x, target.y);
  panelWindow.show();
  // 렌더러가 panel-card-hidden 초기 상태로 들어가 있다가 broadcast를 받으면
  // CSS keyframe으로 페이드 + slide-up 등장 — 윈도우 단의 opacity dance 불필요.
  broadcast("panel.openChanged", { open: true });
}

export function hidePanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  savePanelPos();
  panelWindow.hide();
  broadcast("panel.openChanged", { open: false });
}
