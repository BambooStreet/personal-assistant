import { useEffect } from "react";

import { AvatarShell } from "./components/widget/AvatarShell";
import paApi from "./lib/api";
import { useClickThrough } from "./lib/useClickThrough";
import { usePanelSync } from "./lib/usePanelSync";
import { api } from "./lib/runtime";
import { useBriefingStore } from "./stores/useBriefingStore";
import { useUiStore } from "./stores/useUiStore";
import { useUserSettingsStore } from "./stores/useUserSettingsStore";

// avatarWindow 전용 React tree. 144x144 윈도우에 AvatarShell만 렌더.
// 패널은 별도 panelWindow에서 렌더된다.
function AvatarApp() {
  const setMainTab = useUiStore((s) => s.setMainTab);
  const bootstrapBriefing = useBriefingStore((s) => s.bootstrap);
  const loadUserSettings = useUserSettingsStore((s) => s.load);

  useClickThrough();
  usePanelSync();

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
        void paApi.windowSetPanelOpen(true);
      }
    });
  }, [bootstrapBriefing, setMainTab]);

  return (
    <div className="relative h-screen w-screen">
      <AvatarShell />
    </div>
  );
}

export default AvatarApp;
