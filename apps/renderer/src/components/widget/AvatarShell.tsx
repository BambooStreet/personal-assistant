import { useRef, type MouseEvent } from "react";

import paApi from "../../lib/api";
import { Avatar } from "../avatar/Avatar";
import { useUiStore } from "../../stores/useUiStore";

const DRAG_THRESHOLD_PX = 5;

interface DragOrigin {
  x: number;
  y: number;
  dragged: boolean;
  dragStarted: boolean;
}

export function AvatarShell() {
  const avatarState = useUiStore((s) => s.avatarState);
  const panelOpen = useUiStore((s) => s.panelOpen);

  const originRef = useRef<DragOrigin | null>(null);

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    originRef.current = {
      x: e.clientX,
      y: e.clientY,
      dragged: false,
      dragStarted: false,
    };

    const onMove = (ev: globalThis.MouseEvent) => {
      const o = originRef.current;
      if (!o) return;
      if (o.dragStarted) return;
      const dx = ev.clientX - o.x;
      const dy = ev.clientY - o.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        o.dragged = true;
        o.dragStarted = true;
        window.removeEventListener("mousemove", onMove);
        void paApi.windowStartDragging();
      }
    };

    const onUp = () => {
      const o = originRef.current;
      cleanup();
      originRef.current = null;
      if (!o) return;
      if (o.dragStarted) {
        void paApi.windowStopDragging();
        return;
      }
      if (!o.dragged) {
        void paApi.windowSetPanelOpen(!panelOpen);
      }
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // 아바타는 항상 윈도우 좌하단 고정. 패널이 위로 펼쳐지면서 아바타 상단을 살짝 덮음.
  return (
    <div
      onMouseDown={handleMouseDown}
      data-clickable="true"
      className="absolute bottom-0 left-0 z-10 flex h-36 w-36 cursor-grab items-center justify-center select-none active:cursor-grabbing"
      role="button"
      aria-label="avatar"
    >
      <Avatar state={avatarState} size={120} />
    </div>
  );
}
