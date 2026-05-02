import { useEffect, useRef } from "react";

import { AvatarShell } from "./components/widget/AvatarShell";
import paApi from "./lib/api";
import { useAvatarSync } from "./lib/useAvatarSync";
import { useClickThrough } from "./lib/useClickThrough";
import { usePanelSync } from "./lib/usePanelSync";
import { api } from "./lib/runtime";
import { getGreeting, invalidateGreeting } from "./lib/voice/greeting";
import { VoiceController } from "./lib/voice/controller";
import { useBriefingStore } from "./stores/useBriefingStore";
import { useUiStore } from "./stores/useUiStore";
import { useUserSettingsStore } from "./stores/useUserSettingsStore";

// avatarWindow 전용 React tree. 144x144 윈도우에 AvatarShell만 렌더.
// 패널은 별도 panelWindow에서 렌더된다.
function AvatarApp() {
  const setMainTab = useUiStore((s) => s.setMainTab);
  const bootstrapBriefing = useBriefingStore((s) => s.bootstrap);
  const loadUserSettings = useUserSettingsStore((s) => s.load);
  const userName = useUserSettingsStore((s) => s.userName);
  const voice = useUserSettingsStore((s) => s.voice);
  const micDeviceId = useUserSettingsStore((s) => s.micDeviceId);

  useClickThrough();
  usePanelSync();
  useAvatarSync();

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

  // VoiceController는 AvatarApp 생애주기 동안 단일 인스턴스. opts는 settings 변경 시 갱신.
  const voiceRef = useRef<VoiceController | null>(null);
  if (!voiceRef.current) {
    voiceRef.current = new VoiceController({
      greeting: () => getGreeting(userName, voice),
      voice,
      micDeviceId,
      onError: (msg) => console.warn("[voice]", msg),
    });
  }

  useEffect(() => {
    voiceRef.current?.updateOptions({
      greeting: () => getGreeting(userName, voice),
      voice,
      micDeviceId,
    });
  }, [userName, voice, micDeviceId]);

  // 사용자 이름이나 voice 변경되면 인사 캐시 무효화 (다음 wake 시 재생성).
  useEffect(() => {
    invalidateGreeting();
  }, [userName, voice]);

  // Main이 broadcast하는 voice.wake 이벤트로 사이클 시작 (단축키 → Main → 여기로).
  // 토글 게이트는 Phase C에서 "항시 마이크 켜짐" 의미로 재도입 예정 — 단축키 트리거는 항상 동작.
  useEffect(() => {
    const off = paApi.on("voice.wake", () => {
      console.info("[voice] wake → cycle start");
      void voiceRef.current?.wake();
    });
    return () => off();
  }, []);

  return (
    <div className="relative h-screen w-screen">
      <AvatarShell />
    </div>
  );
}

export default AvatarApp;
