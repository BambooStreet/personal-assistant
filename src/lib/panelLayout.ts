import {
  LogicalPosition,
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";

import type {
  PanelDirection,
  PanelHorizontal,
} from "../stores/useUiStore";

// 패널 영역 높이/폭. 4분면 변경 시 윈도우 보정 거리.
const PANEL_OFFSET_Y_LOGICAL = 416; // 560 - 144(아바타)
const PANEL_OFFSET_X_LOGICAL = 216; // 360 - 144(아바타)

// 윈도우 안에서 아바타 영역의 중심 (logical px 기준).
// vertical:
//   "top"   → 패널이 윈도우 위쪽 → 아바타가 윈도우 좌하단 → 중심 y = 488
//   "bottom"→ 패널이 윈도우 아래쪽 → 아바타가 윈도우 좌상단 → 중심 y = 72
// horizontal:
//   "left"  → 아바타가 윈도우 좌측  → 중심 x = 72
//   "right" → 아바타가 윈도우 우측  → 중심 x = 288
const AVATAR_CENTER_Y_LOGICAL = { top: 488, bottom: 72 } as const;
const AVATAR_CENTER_X_LOGICAL = { left: 72, right: 288 } as const;

export interface Quadrant {
  vertical: PanelDirection;
  horizontal: PanelHorizontal;
}

export async function decideQuadrant(fallback: Quadrant): Promise<Quadrant> {
  try {
    const win = getCurrentWindow();
    const [pos, scale, current, primary] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      currentMonitor(),
      primaryMonitor(),
    ]);
    const monitor = current ?? primary;
    if (!monitor) {
      console.warn("[pa] decideQuadrant: no monitor info");
      return fallback;
    }
    // 아바타의 화면상 실제 중심 (physical). 윈도우 중심이 아니라 아바타 중심 기준.
    const avatarCenterY =
      pos.y + AVATAR_CENTER_Y_LOGICAL[fallback.vertical] * scale;
    const avatarCenterX =
      pos.x + AVATAR_CENTER_X_LOGICAL[fallback.horizontal] * scale;
    const monCenterY = monitor.position.y + monitor.size.height / 2;
    const monCenterX = monitor.position.x + monitor.size.width / 2;
    return {
      vertical: avatarCenterY > monCenterY ? "top" : "bottom",
      horizontal: avatarCenterX > monCenterX ? "right" : "left",
    };
  } catch (e) {
    console.error("[pa] decideQuadrant failed", e);
    return fallback;
  }
}

/// 4분면 변경 시 사용자 시각상 아바타 위치를 유지하기 위해 윈도우 자체를 반대로 이동.
/// vertical 변경: ±416px, horizontal 변경: ±216px.
export async function shiftWindow(
  prev: Quadrant,
  next: Quadrant,
): Promise<void> {
  if (prev.vertical === next.vertical && prev.horizontal === next.horizontal) {
    return;
  }
  let offsetX = 0;
  let offsetY = 0;
  if (prev.vertical !== next.vertical) {
    // top→bottom: 아바타가 윈도우 좌하단→좌상단, 윈도우는 +416 아래로
    // bottom→top: 윈도우는 -416 위로
    offsetY =
      next.vertical === "bottom" ? PANEL_OFFSET_Y_LOGICAL : -PANEL_OFFSET_Y_LOGICAL;
  }
  if (prev.horizontal !== next.horizontal) {
    // left→right: 아바타가 윈도우 좌측→우측, 윈도우는 -216 좌측으로
    // right→left: 윈도우는 +216 우측으로
    offsetX =
      next.horizontal === "right" ? -PANEL_OFFSET_X_LOGICAL : PANEL_OFFSET_X_LOGICAL;
  }
  try {
    const win = getCurrentWindow();
    const [phys, scale] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
    ]);
    const logicalX = phys.x / scale + offsetX;
    const logicalY = phys.y / scale + offsetY;
    await win.setPosition(new LogicalPosition(logicalX, logicalY));
  } catch (e) {
    console.error("[pa] shiftWindow failed", e);
  }
}
