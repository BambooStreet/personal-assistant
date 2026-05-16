import { useEffect } from "react";

import { BottomPanel } from "./components/widget/BottomPanel";
import { api, type ChatTurn } from "./lib/api";
import { cn } from "./lib/cn";
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
  const appendContinuedTurn = useChatStore((s) => s.appendContinuedTurn);
  const appendWakeCall = useChatStore((s) => s.appendWakeCall);

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

  // 다른 윈도우의 chat.continue 결과 (도구 confirm 후 마무리 응답) 동기화.
  useEffect(() => {
    const off = api.on("chat.turnContinued", (data) => {
      const d = data as { turn?: unknown };
      if (!d.turn) return;
      appendContinuedTurn(d.turn as ChatTurn);
    });
    return () => off();
  }, [appendContinuedTurn]);

  // wake 호출 + 인사 — UI에만 표시 (DB persist 안 함).
  useEffect(() => {
    const off = api.on("chat.wakeCalled", (data) => {
      const d = data as { userName?: unknown; displayLabel?: unknown };
      const name = typeof d.userName === "string" ? d.userName : "";
      const label = typeof d.displayLabel === "string" ? d.displayLabel : "";
      appendWakeCall(name, label);
    });
    return () => off();
  }, [appendWakeCall]);

  // voice 사이클이 보낸 도구 confirm/reject 요청 처리 — pendingTool 자동 실행.
  useEffect(() => {
    const offConfirm = api.on("voice.toolConfirmRequested", (data) => {
      const d = data as { tool_call_id?: unknown };
      if (typeof d.tool_call_id !== "string") return;
      void useChatStore.getState().confirmPendingByVoice(d.tool_call_id);
    });
    const offReject = api.on("voice.toolRejectRequested", (data) => {
      const d = data as { tool_call_id?: unknown };
      if (typeof d.tool_call_id !== "string") return;
      void useChatStore.getState().rejectPendingByVoice(d.tool_call_id);
    });
    return () => {
      offConfirm();
      offReject();
    };
  }, []);

  // Core 프로세스 크래시를 사용자에게 노출 — 헤더 배너로 표시.
  // willRestart=true면 supervisor가 재시작 시도 중, false면 한계 초과.
  const setCoreStatus = useUiStore((s) => s.setCoreStatus);
  useEffect(() => {
    const off = api.on("core.crashed", (data) => {
      const d = data as {
        reason?: unknown;
        willRestart?: unknown;
        attempt?: unknown;
      };
      const reason = typeof d.reason === "string" ? d.reason : "unknown";
      const attempt = typeof d.attempt === "number" ? d.attempt : 0;
      const willRestart = d.willRestart === true;
      setCoreStatus({
        kind: willRestart ? "restarting" : "crashed",
        reason,
        attempt,
      });
    });
    return () => off();
  }, [setCoreStatus]);

  // panel-card-hidden ↔ panel-card-enter 클래스 토글만으로 CSS 애니메이션이 매 등장마다
  // 자연 replay됨 — 브라우저가 animation-name 변화를 감지해 0%부터 재생. key 기반 remount는
  // BottomPanel 전체 자식 트리(ChatPanel scroll position, ChatInput focus 등)를 잃게 만들어 사용 안 함.
  const panelOpen = useUiStore((s) => s.panelOpen);

  return (
    <div
      className={cn(
        "relative h-screen w-screen",
        panelOpen ? "panel-card-enter" : "panel-card-hidden",
      )}
      data-clickable="true"
    >
      <BottomPanel />
    </div>
  );
}

export default PanelApp;
