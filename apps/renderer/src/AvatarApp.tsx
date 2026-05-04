import { useEffect, useRef, useCallback } from "react";

import { AvatarShell } from "./components/widget/AvatarShell";
import paApi from "./lib/api";
import { useAvatarSync } from "./lib/useAvatarSync";
import { useClickThrough } from "./lib/useClickThrough";
import { usePanelSync } from "./lib/usePanelSync";
import { api } from "./lib/runtime";
import { getGreeting, invalidateGreeting } from "./lib/voice/greeting";
import { VoiceController } from "./lib/voice/controller";
import { getDetector } from "./lib/voice/wakeword";
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
  const voiceEnabled = useUserSettingsStore((s) => s.voiceEnabled);

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
  useEffect(() => {
    const off = paApi.on("voice.wake", () => {
      console.info("[voice] wake → cycle start (shortcut)");
      void voiceRef.current?.wake();
    });
    return () => off();
  }, []);

  // panelWindow에서 voiceEnabled 토글 시 동기화.
  const setVoiceEnabled = useUserSettingsStore((s) => s.setVoiceEnabled);
  useEffect(() => {
    const off = paApi.on("voice.enabledChanged", (data: unknown) => {
      const { enabled } = data as { enabled: boolean };
      console.info("[voice] enabledChanged →", enabled);
      useUserSettingsStore.setState({ voiceEnabled: enabled });
    });
    return () => off();
  }, [setVoiceEnabled]);

  // Wake word 상시 리스닝 (Phase C-2).
  // voiceEnabled가 켜져있고 학습된 모델이 있으면 백그라운드에서 호칭을 감지한다.
  // 음성 사이클 진행 중엔 VoiceController가 idle이 아니므로 wake()가 무시됨 → 충돌 없음.
  const wakeListeningRef = useRef(false);

  const startWakeListening = useCallback(async () => {
    if (wakeListeningRef.current) return;
    const detector = getDetector();
    try {
      await detector.init();
      const loaded = await detector.load();
      console.info("[wake] load result:", loaded, "labels:", detector.wordLabels(), "isTrained:", detector.isTrained());
      if (!loaded || !detector.isTrained()) {
        console.info("[wake] no trained model — skipping listen");
        return;
      }
      await detector.listen((result) => {
        console.info("[wake] detected! score=", result.wakeScore.toFixed(3));
        void voiceRef.current?.wake();
      });
      wakeListeningRef.current = true;
      console.info("[wake] listening started");
    } catch (e) {
      console.warn("[wake] failed to start listening", e);
    }
  }, []);

  const stopWakeListening = useCallback(async () => {
    if (!wakeListeningRef.current) return;
    const detector = getDetector();
    try {
      await detector.stopListen();
    } catch (e) {
      console.warn("[wake] failed to stop listening", e);
    }
    wakeListeningRef.current = false;
    console.info("[wake] listening stopped");
  }, []);

  useEffect(() => {
    if (voiceEnabled) {
      void startWakeListening();
    } else {
      void stopWakeListening();
    }
    return () => {
      void stopWakeListening();
    };
  }, [voiceEnabled, startWakeListening, stopWakeListening]);

  return (
    <div className="relative h-screen w-screen">
      <AvatarShell />
    </div>
  );
}

export default AvatarApp;
