import { useEffect } from "react";

import { BottomPanel } from "./components/widget/BottomPanel";
import { api, type ChatTurn } from "./lib/api";
import { useAvatarSync } from "./lib/useAvatarSync";
import { useClickThrough } from "./lib/useClickThrough";
import { usePanelSync } from "./lib/usePanelSync";
import { useChatStore } from "./stores/useChatStore";
import { useUiStore } from "./stores/useUiStore";
import { useUserSettingsStore } from "./stores/useUserSettingsStore";

// panelWindow 전용 React tree. BottomPanel만 렌더, 윈도우 전체가 panel.
function PanelApp() {
  useClickThrough();
  usePanelSync();
  useAvatarSync();

  const setMainTab = useUiStore((s) => s.setMainTab);
  const loadUserSettings = useUserSettingsStore((s) => s.load);
  const appendExternalTurn = useChatStore((s) => s.appendExternalTurn);

  // PanelApp은 별도 React tree라 store 인스턴스가 분리됨 — 자체적으로 settings 로드.
  useEffect(() => {
    void loadUserSettings();
  }, [loadUserSettings]);

  // 트레이 "설정" 메뉴가 broadcast하면 settings 탭으로 전환.
  useEffect(() => {
    const off = api.on("panel.openSettings", () => {
      setMainTab("settings");
    });
    return () => off();
  }, [setMainTab]);

  // AvatarApp의 voice cycle이 발생시킨 chat 결과를 패널 채팅창에도 반영.
  useEffect(() => {
    const off = api.on("chat.turnAdded", (data) => {
      const d = data as { user_message?: unknown; turn?: unknown };
      if (typeof d.user_message !== "string" || !d.turn) return;
      appendExternalTurn(d.user_message, d.turn as ChatTurn);
    });
    return () => off();
  }, [appendExternalTurn]);

  return (
    <div className="relative h-screen w-screen" data-clickable="true">
      <BottomPanel />
    </div>
  );
}

export default PanelApp;
