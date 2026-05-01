import { useRef, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { cn } from "../../lib/cn";
import { decideQuadrant, shiftWindow } from "../../lib/panelLayout";
import { Avatar } from "../avatar/Avatar";
import { useUiStore } from "../../stores/useUiStore";

const DRAG_THRESHOLD_PX = 5;

interface DragOrigin {
  x: number;
  y: number;
  dragged: boolean;
}

export function AvatarShell() {
  const avatarState = useUiStore((s) => s.avatarState);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const panelDirection = useUiStore((s) => s.panelDirection);
  const panelHorizontal = useUiStore((s) => s.panelHorizontal);
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);
  const setPanelDirection = useUiStore((s) => s.setPanelDirection);
  const setPanelHorizontal = useUiStore((s) => s.setPanelHorizontal);

  const originRef = useRef<DragOrigin | null>(null);

  const onAvatarTap = async () => {
    if (!panelOpen) {
      const prev = { vertical: panelDirection, horizontal: panelHorizontal };
      const next = await decideQuadrant(prev);
      if (
        next.vertical !== prev.vertical ||
        next.horizontal !== prev.horizontal
      ) {
        await shiftWindow(prev, next);
        setPanelDirection(next.vertical);
        setPanelHorizontal(next.horizontal);
      }
    }
    setPanelOpen(!panelOpen);
  };

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    originRef.current = { x: e.clientX, y: e.clientY, dragged: false };

    const onMove = (ev: globalThis.MouseEvent) => {
      const o = originRef.current;
      if (!o || o.dragged) return;
      const dx = ev.clientX - o.x;
      const dy = ev.clientY - o.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        o.dragged = true;
        cleanup();
        void getCurrentWindow()
          .startDragging()
          .catch((err) => console.error("startDragging failed", err));
      }
    };

    const onUp = () => {
      const o = originRef.current;
      cleanup();
      originRef.current = null;
      if (o && !o.dragged) {
        void onAvatarTap();
      }
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        "absolute flex h-36 w-36 cursor-grab items-center justify-center select-none active:cursor-grabbing",
        panelDirection === "top" ? "bottom-0" : "top-0",
        panelHorizontal === "left" ? "left-0" : "right-0",
      )}
      role="button"
      aria-label="avatar"
    >
      <Avatar state={avatarState} size={120} />
    </div>
  );
}
