import { useEffect } from "react";

import { BottomPanel } from "./components/widget/BottomPanel";
import paApi from "./lib/api";
import { useClickThrough } from "./lib/useClickThrough";
import { usePanelSync } from "./lib/usePanelSync";
import { useUiStore } from "./stores/useUiStore";
import { useUserSettingsStore } from "./stores/useUserSettingsStore";

// panelWindow 전용 React tree. BottomPanel만 렌더, 윈도우 전체가 panel.
function PanelApp() {
  useClickThrough();
  usePanelSync();

  const setMainTab = useUiStore((s) => s.setMainTab);
  const loadUserSettings = useUserSettingsStore((s) => s.load);

  // PanelApp은 별도 React tree라 store 인스턴스가 분리됨 — 자체적으로 settings 로드.
  useEffect(() => {
    void loadUserSettings();
  }, [loadUserSettings]);

  // 트레이 "설정" 메뉴가 broadcast하면 settings 탭으로 전환.
  useEffect(() => {
    const off = paApi.on("panel.openSettings", () => {
      setMainTab("settings");
    });
    return () => off();
  }, [setMainTab]);

  return (
    <div className="relative h-screen w-screen" data-clickable="true">
      <BottomPanel />
    </div>
  );
}

export default PanelApp;
