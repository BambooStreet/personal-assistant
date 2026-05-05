import { type BrowserWindow, screen } from "electron";

// 드래그 세션을 윈도우별로 추적. AvatarShell/Panel 헤더가 windowStartDragging IPC를
// 호출하면 해당 sender의 BrowserWindow만 cursor를 따라 이동.
const DRAG_TICK_MS = 8;
const DRAG_SAFETY_MS = 5_000;

interface DragSession {
  interval: NodeJS.Timeout;
  safety: NodeJS.Timeout;
}

const sessions = new Map<number, DragSession>();

export function startDragForWindow(win: BrowserWindow): void {
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

  // stop 신호가 누락돼도 자체 만료. 사용자 손가락이 윈도우 밖에서 떼는 등의 상황을 방어.
  const safety = setTimeout(() => {
    console.warn("[drag] safety timeout — stop signal missing");
    stopDragForWindow(winId);
  }, DRAG_SAFETY_MS);

  sessions.set(winId, { interval, safety });
}

export function stopDragForWindow(winId: number): void {
  const s = sessions.get(winId);
  if (s) {
    clearInterval(s.interval);
    clearTimeout(s.safety);
    sessions.delete(winId);
  }
}
