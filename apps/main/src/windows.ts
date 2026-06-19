import { app, BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";

import { state } from "./state";

// 두 윈도우(아바타/패널)와 그 위치 영속화/show-hide/broadcast를 담당.
// 다른 모듈은 getAvatarWindow/getPanelWindow getter를 통해 접근하고,
// 직접 BrowserWindow 인스턴스를 보존하지 않는다.

const AVATAR_W = 200;
const AVATAR_H = 200;
const PANEL_W = 520;
const PANEL_H = 680;
// 패널 "닫힘" 상태의 화면 밖 park 좌표(D-005 offscreen-park). hide() 대신 여기로 옮겨
// transparent+frameless first-show 깜빡임을 회피한다.
const PANEL_PARK = -20000;

let avatarWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;

// 패널은 아바타와 독립적으로 항상 화면 정중앙에 등장한다(D-006의 상대 오프셋 방식 폐기).
// 위치를 기억하지 않으므로 열 때마다 정중앙을 재계산. 세션 내 드래그는 가능하지만
// 다음 등장 때 다시 중앙으로 돌아온다.

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
  // dev(패키징 안 됨)에서는 아바타를 숨김 상태로 시작 — 윈도우를 안 띄우면 렌더러가
  // 마운트 시 getAvatarVisible(=isVisible)로 false를 읽어 마이크/웨이크워드도 자동 off된다.
  // 트레이 아이콘/메뉴로 언제든 보이기 가능. 패키징 빌드는 기존대로 보이게 시작.
  const startHidden = !app.isPackaged;
  const win = new BrowserWindow({
    width: AVATAR_W,
    height: AVATAR_H,
    x: savedPos?.x,
    y: savedPos?.y,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true, // 아바타는 순수 위젯 — 작업표시줄 점유 안 함(패널만 창처럼).
    backgroundColor: "#00000000",
    center: !savedPos, // 저장된 좌표가 없으면 center로
    show: !startHidden,
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
    if (startHidden) return; // dev 기본 숨김 — 트레이로 보이기 전까지 띄우지 않음
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
      // hideAvatar()를 거치지 않는 경로 — 가시성 변화 broadcast를 직접 발행
      // (Alt+F4로 숨겨도 마이크/웨이크워드가 꺼지도록).
      broadcast("avatar.visibilityChanged", { visible: false });
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
    skipTaskbar: true, // 초기 = 닫힘. open/close에 맞춰 setSkipTaskbar로 토글(열렸을 때만 버튼).
    title: "Personal Assistant", // 작업표시줄 버튼 라벨/툴팁.
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
  // 패널은 일반 창처럼 동작 — alwaysOnTop 미적용(아바타만 항상 위). 다른 앱을 클릭하면
  // 패널이 그 뒤로 들어간다. (아바타는 createAvatarWindow에서 별도로 always-on-top)
  loadRenderer(win, "panel");
  win.setIgnoreMouseEvents(true, { forward: true });

  panelWindow = win;
  // offscreen-park(D-005 부활): transparent+frameless 창은 hide()→show() 사이클마다
  // first-show 흰 프레임이 깜빡인다. 그래서 창은 항상 visible로 두고 "닫힘"은 화면
  // 밖(PANEL_PARK)으로 park만 한다. 생성 직후 offscreen에서 showInactive로 한 번
  // paint해 두면, 이후 등장은 setBounds 이동뿐이라 깜빡임이 없다. 작업표시줄 버튼은
  // open/close에 맞춰 setSkipTaskbar로 토글(최소화는 네이티브 minimize 사용).
  win.setBounds({ x: PANEL_PARK, y: PANEL_PARK, width: PANEL_W, height: PANEL_H });
  win.once("ready-to-show", () => win.showInactive());

  // 사용자가 OS-level close (Alt+F4)를 눌러도 hide만.
  win.on("close", (e) => {
    if (!state.isQuitting) {
      e.preventDefault();
      hidePanel();
    }
  });
  return win;
}

// 현재 커서가 있는 디스플레이의 workArea 정중앙에 패널을 배치.
// 아바타 위치를 참조하지 않아 숨김 상태에서도 아바타를 깨우지 않고 패널만 띄울 수 있다.
function positionPanelCenter(): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const x = wa.x + Math.round((wa.width - PANEL_W) / 2);
  const y = wa.y + Math.round((wa.height - PANEL_H) / 2);
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
  // 가시성 변화를 렌더러에 전파 — 숨김 모드 해제 시 웨이크워드/음성 재개.
  broadcast("avatar.visibilityChanged", { visible: true });
}

export function hideAvatar(): void {
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  if (avatarWindow.isVisible()) avatarWindow.hide();
  hidePanel();
  // 숨김 모드 진입 — 렌더러가 마이크/웨이크워드/TTS 연출을 멈추도록 알림.
  broadcast("avatar.visibilityChanged", { visible: false });
}

export function showPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  panelWindow.setSkipTaskbar(false); // 열림 → 작업표시줄 버튼 노출
  // 최소화 상태(트레이 "패널 열기")면 복원부터. 작업표시줄 버튼 클릭은 OS가 알아서 restore.
  if (panelWindow.isMinimized()) panelWindow.restore();
  const center = positionPanelCenter();
  const target = clampPanelTop(center.x, center.y);
  // offscreen-park에서 onscreen으로 이동만. show() 호출 없음(이미 visible) → 깜빡임 없음.
  panelWindow.setBounds({
    x: target.x,
    y: target.y,
    width: PANEL_W,
    height: PANEL_H,
  });
  if (!panelWindow.isVisible()) panelWindow.showInactive(); // 안전망(보통 이미 visible)
  panelWindow.focus();
  // 렌더러가 panel-card-hidden(opacity:0) 상태로 onscreen 진입 → broadcast 받으면
  // CSS keyframe으로 페이드+slide-up 등장. 창은 투명이라 흰 플래시 없음.
  broadcast("panel.openChanged", { open: true });
}

export function hidePanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  // hide() 대신 offscreen-park + 작업표시줄 버튼 제거 → 재등장 시 흰 깜빡임 없음.
  panelWindow.setSkipTaskbar(true);
  panelWindow.setBounds({
    x: PANEL_PARK,
    y: PANEL_PARK,
    width: PANEL_W,
    height: PANEL_H,
  });
  broadcast("panel.openChanged", { open: false });
}
