import { useEffect } from "react";

import { api } from "./api";
import { useUiStore } from "../stores/useUiStore";

// Main이 broadcast하는 panel.openChanged를 받아 local store를 갱신.
// AvatarApp, PanelApp 둘 다 구독해야 양쪽 UI가 같은 상태를 본다.
export function usePanelSync(): void {
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);
  useEffect(() => {
    const off = api.on("panel.openChanged", (data) => {
      const open = !!(data as { open?: boolean })?.open;
      setPanelOpen(open);
    });
    return () => off();
  }, [setPanelOpen]);
}
