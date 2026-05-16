import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Avatar } from "../avatar/Avatar";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useUiStore } from "../../stores/useUiStore";

// 드래그 점 — hover 시점에 drag region을 토글.
// drag region이 켜진 동안엔 mouseleave가 안 오므로 window mousemove로 cursor가 wrapper
// 바깥으로 멀어졌는지 폴링해서 해제. drag region은 자기 요소 위에서만 이벤트를 가로채고,
// 다른 영역(투명 padding, 아바타 등)에서의 window mousemove는 정상 발화하므로 outside 감지 가능.
const DRAG_STYLE = {
  WebkitAppRegion: "drag",
  cursor: "grab",
} as CSSProperties;

export function AvatarShell() {
  const avatarState = useUiStore((s) => s.avatarState);
  const [dragReady, setDragReady] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleAvatarClick = () => {
    void api.windowSetPanelOpen(true);
  };

  useEffect(() => {
    if (!dragReady) return;
    const onMove = (e: MouseEvent) => {
      const el = wrapperRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margin = 4;
      const outside =
        e.clientX < r.left - margin ||
        e.clientX > r.right + margin ||
        e.clientY < r.top - margin ||
        e.clientY > r.bottom + margin;
      if (outside) setDragReady(false);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [dragReady]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={wrapperRef}
        onMouseEnter={() => setDragReady(true)}
        style={dragReady ? DRAG_STYLE : undefined}
        className="absolute right-[18px] top-[93px] z-20 h-6 w-6"
        aria-label="윈도우 드래그"
      >
        <div
          className={cn(
            "absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 ease-out",
            dragReady ? "scale-125 bg-fg-muted" : "bg-fg-muted/40",
          )}
        />
      </div>
      <div className="absolute bottom-0 left-0 z-10 flex h-[200px] w-[200px] items-center justify-center">
        <button
          type="button"
          onClick={handleAvatarClick}
          data-clickable="true"
          className="flex h-[140px] w-[140px] cursor-pointer items-center justify-center rounded-full bg-transparent p-0 select-none transition-transform duration-150 ease-out hover:scale-105 focus:outline-none focus-visible:outline-none"
          aria-label="패널 열기"
        >
          <Avatar state={avatarState} size={140} />
        </button>
      </div>
    </div>
  );
}
