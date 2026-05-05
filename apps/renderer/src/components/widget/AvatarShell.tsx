import { useRef, type MouseEvent } from "react";

import { api } from "../../lib/api";
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
        void api.windowStartDragging();
      }
    };

    const onUp = () => {
      const o = originRef.current;
      cleanup();
      originRef.current = null;
      if (!o) return;
      if (o.dragStarted) {
        void api.windowStopDragging();
        return;
      }
      if (!o.dragged) {
        void api.windowSetPanelOpen(!panelOpen);
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
      className="absolute bottom-0 left-0 z-10 flex h-[200px] w-[200px] cursor-grab items-center justify-center select-none transition-transform duration-150 ease-out hover:scale-105 active:scale-95 active:cursor-grabbing"
      role="button"
      aria-label="avatar"
    >
      <Avatar state={avatarState} size={140} />
    </div>
  );
}
