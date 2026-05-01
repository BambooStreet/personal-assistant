import { useEffect, useLayoutEffect } from "react";

import { AvatarShell } from "./components/widget/AvatarShell";
import { BottomPanel } from "./components/widget/BottomPanel";
import { cn } from "./lib/cn";
import { api } from "./lib/tauri";
import { useBriefingStore } from "./stores/useBriefingStore";
import { useUiStore } from "./stores/useUiStore";
import { useUserSettingsStore } from "./stores/useUserSettingsStore";

const PANEL_RECT_TOP = { x: 0, y: 0, w: 360, h: 416 };
const PANEL_RECT_BOTTOM = { x: 0, y: 144, w: 360, h: 416 };
const AVATAR_TOP_LEFT = { x: 0, y: 0, w: 144, h: 144 };
const AVATAR_TOP_RIGHT = { x: 216, y: 0, w: 144, h: 144 };
const AVATAR_BOTTOM_LEFT = { x: 0, y: 416, w: 144, h: 144 };
const AVATAR_BOTTOM_RIGHT = { x: 216, y: 416, w: 144, h: 144 };

function App() {
  const panelOpen = useUiStore((s) => s.panelOpen);
  const panelDirection = useUiStore((s) => s.panelDirection);
  const panelHorizontal = useUiStore((s) => s.panelHorizontal);
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);
  const setMainTab = useUiStore((s) => s.setMainTab);
  const bootstrapBriefing = useBriefingStore((s) => s.bootstrap);
  const loadUserSettings = useUserSettingsStore((s) => s.load);

  useEffect(() => {
    api
      .appHealth()
      .then((h) =>
        console.info("[pa] app health", h.version, "db_ok=", h.db_ok),
      )
      .catch((e) => console.error("[pa] app health failed", e));
    void loadUserSettings();
  }, [loadUserSettings]);

  useEffect(() => {
    void bootstrapBriefing().then((res) => {
      if (res?.created) {
        setMainTab("chat");
        setPanelOpen(true);
      }
    });
  }, [bootstrapBriefing, setMainTab, setPanelOpen]);

  useLayoutEffect(() => {
    const avatarRect =
      panelDirection === "top"
        ? panelHorizontal === "left"
          ? AVATAR_BOTTOM_LEFT
          : AVATAR_BOTTOM_RIGHT
        : panelHorizontal === "left"
          ? AVATAR_TOP_LEFT
          : AVATAR_TOP_RIGHT;
    const panelRect =
      panelDirection === "top" ? PANEL_RECT_TOP : PANEL_RECT_BOTTOM;
    const rects = panelOpen ? [panelRect, avatarRect] : [avatarRect];
    api
      .windowSetHitRegion(rects)
      .catch((e) => console.error("[pa] hit region failed", e));
  }, [panelOpen, panelDirection, panelHorizontal]);

  return (
    <div className="relative h-screen w-screen">
      <div
        className={cn(
          "absolute inset-x-0 transition-opacity duration-150 ease-out",
          panelDirection === "top" ? "top-0 bottom-36" : "top-36 bottom-0",
          panelOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!panelOpen}
      >
        <BottomPanel />
      </div>
      <AvatarShell />
    </div>
  );
}

export default App;
