import { useEffect, useLayoutEffect } from "react";

import { AvatarShell } from "./components/widget/AvatarShell";
import { BottomPanel } from "./components/widget/BottomPanel";
import { cn } from "./lib/cn";
import { api } from "./lib/runtime";
import { useBriefingStore } from "./stores/useBriefingStore";
import { useUiStore } from "./stores/useUiStore";
import { useUserSettingsStore } from "./stores/useUserSettingsStore";

function App() {
  const panelOpen = useUiStore((s) => s.panelOpen);
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
    api
      .windowApplyPanelState({ open: panelOpen })
      .catch((e) => console.error("[pa] applyPanelState failed", e));
  }, [panelOpen]);

  // 패널은 항상 윈도우 상단(top-0)에서 416px 높이로 펼쳐진다.
  // AvatarShell이 좌하단(z-10)에 항상 있으니 패널 하단 ~72px과 시각적으로 살짝 겹친다.
  return (
    <div className="relative h-screen w-screen">
      <div
        className={cn(
          "absolute inset-x-0 top-0 transition-opacity duration-150 ease-out",
          panelOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{ height: 416 }}
        aria-hidden={!panelOpen}
      >
        <BottomPanel />
      </div>
      <AvatarShell />
    </div>
  );
}

export default App;
