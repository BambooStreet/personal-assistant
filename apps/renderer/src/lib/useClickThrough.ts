import { useEffect } from "react";

import { api } from "./api";

// cursor 아래 요소에 `data-clickable="true"` ancestor가 없으면 OS 클릭이 통과,
// 있으면 클릭이 캡처. forward:true 덕에 무시 모드에서도 mousemove는 계속 도착.
export function useClickThrough(): void {
  useEffect(() => {
    let lastIgnore: boolean | null = null;
    const handler = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const interactive =
        !!el && (el as HTMLElement).closest('[data-clickable="true"]') !== null;
      const shouldIgnore = !interactive;
      if (shouldIgnore !== lastIgnore) {
        lastIgnore = shouldIgnore;
        void api.windowSetClickThrough(shouldIgnore);
      }
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);
}
