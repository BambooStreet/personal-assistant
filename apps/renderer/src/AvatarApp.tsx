import { useEffect, useRef, useCallback } from "react";

import { AvatarShell } from "./components/widget/AvatarShell";
import { api } from "./lib/api";
import { useAvatarSync } from "./lib/useAvatarSync";
import { usePanelSync } from "./lib/usePanelSync";
import { useTheme } from "./lib/useTheme";
import { getGreeting, invalidateGreeting } from "./lib/voice/greeting";
import { VoiceController } from "./lib/voice/controller";
import { getDetector } from "./lib/voice/wakeword";
import { useAuthStore } from "./stores/useAuthStore";
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
  const voiceFollowupEnabled = useUserSettingsStore(
    (s) => s.voiceFollowupEnabled,
  );
  const micThresholdRms = useUserSettingsStore((s) => s.micThresholdRms);
  const micSilenceMs = useUserSettingsStore((s) => s.micSilenceMs);
  const micInitialWaitMs = useUserSettingsStore((s) => s.micInitialWaitMs);
  const micFollowupInitialWaitMs = useUserSettingsStore(
    (s) => s.micFollowupInitialWaitMs,
  );
  const micFollowupMaxDurationMs = useUserSettingsStore(
    (s) => s.micFollowupMaxDurationMs,
  );

  // useClickThrough 호출 안 함 — avatar 윈도우는 native drag 안정성을 위해
  // setIgnoreMouseEvents 패턴을 쓰지 않는다. windows.ts 주석 참조.
  usePanelSync();
  useAvatarSync();
  useTheme();

  const authStatus = useAuthStore((s) => s.status);
  const loadAuth = useAuthStore((s) => s.load);
  const markAuthRequired = useAuthStore((s) => s.markRequired);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    const off = api.on("auth.required", () => markAuthRequired());
    return () => off();
  }, [markAuthRequired]);

  useEffect(() => {
    if (authStatus !== "signed_in") return;
    api
      .appHealth()
      .then((h) =>
        console.info("[pa] app health", h.version, "db_ok=", h.db_ok),
      )
      .catch((e) => console.error("[pa] app health failed", e));
    void loadUserSettings();
  }, [authStatus, loadUserSettings]);

  useEffect(() => {
    if (authStatus !== "signed_in") return;
    void bootstrapBriefing().then(async (res) => {
      if (!res?.created) return;
      setMainTab("chat");
      void api.windowSetPanelOpen(true);

      const settings = useUserSettingsStore.getState();
      if (!settings.autoPlayBriefing) return;

      const briefing = useBriefingStore.getState().briefing;
      if (!briefing) return;

      // BriefingCard가 별도 auto-play 시도하지 않도록 플래그 소비.
      useBriefingStore.getState().consumeAutoPlay();

      try {
        // 인사는 Core 브리핑 텍스트 안에 이미 들어 있다(시각대에 맞춘 첫마디).
        // 예전엔 여기서 "네, ○○님"을 앞에 붙였는데, 그건 wake에 대한 *대답*이라
        // 부팅 맥락엔 맞지 않았다 — 지금은 브리핑 한 덩어리만 읽는다.
        const briefingTts = await api.ttsSpeak(briefing.summary, settings.voice);
        await voiceRef.current?.speakSequence({
          briefingAudio: { b64: briefingTts.audio_b64, mime: briefingTts.mime },
        });
      } catch (e) {
        console.warn("[voice] first-run cycle failed", e);
      }
    });
  }, [authStatus, bootstrapBriefing, setMainTab]);

  // VoiceController는 AvatarApp 생애주기 동안 단일 인스턴스. opts는 settings 변경 시 갱신.
  const voiceRef = useRef<VoiceController | null>(null);
  // 콜백 ref — startWakeListening / stopWakeListening가 아래에 정의되므로 ref로 우회 참조.
  const cycleHooksRef = useRef<{ start: () => void; end: () => void }>({
    start: () => {},
    end: () => {},
  });
  if (!voiceRef.current) {
    voiceRef.current = new VoiceController({
      greeting: () => getGreeting(userName, voice),
      voice,
      micDeviceId,
      initialVad: {
        thresholdRms: micThresholdRms,
        silenceMs: micSilenceMs,
        initialWaitMs: micInitialWaitMs,
      },
      followupVad: {
        thresholdRms: micThresholdRms,
        silenceMs: micSilenceMs,
        initialWaitMs: micFollowupInitialWaitMs,
        maxDurationMs: micFollowupMaxDurationMs,
      },
      followupEnabled: voiceFollowupEnabled,
      onError: (msg) => console.warn("[voice]", msg),
      onCycleStart: () => cycleHooksRef.current.start(),
      onCycleEnd: () => cycleHooksRef.current.end(),
      onWakeBegin: () => {
        const s = useUserSettingsStore.getState();
        void api.windowBroadcast("chat.wakeCalled", {
          userName: s.userName,
          displayLabel: s.wakeDisplayLabel,
        });
      },
    });
  }

  useEffect(() => {
    voiceRef.current?.updateOptions({
      greeting: () => getGreeting(userName, voice),
      voice,
      micDeviceId,
      initialVad: {
        thresholdRms: micThresholdRms,
        silenceMs: micSilenceMs,
        initialWaitMs: micInitialWaitMs,
      },
      followupVad: {
        thresholdRms: micThresholdRms,
        silenceMs: micSilenceMs,
        initialWaitMs: micFollowupInitialWaitMs,
        maxDurationMs: micFollowupMaxDurationMs,
      },
      followupEnabled: voiceFollowupEnabled,
    });
  }, [
    userName,
    voice,
    micDeviceId,
    micThresholdRms,
    micSilenceMs,
    micInitialWaitMs,
    micFollowupInitialWaitMs,
    micFollowupMaxDurationMs,
    voiceFollowupEnabled,
  ]);

  // 사용자 이름이나 voice 변경되면 인사 캐시 무효화 (다음 wake 시 재생성).
  useEffect(() => {
    invalidateGreeting();
  }, [userName, voice]);

  // Main이 broadcast하는 voice.wake 이벤트로 사이클 시작 (단축키 → Main → 여기로).
  useEffect(() => {
    const off = api.on("voice.wake", () => {
      console.info("[voice] wake → cycle start (shortcut)");
      void voiceRef.current?.wake();
    });
    return () => off();
  }, []);

  // panelWindow에서 voiceEnabled 토글 시 동기화.
  const setVoiceEnabled = useUserSettingsStore((s) => s.setVoiceEnabled);
  useEffect(() => {
    const off = api.on("voice.enabledChanged", (data: unknown) => {
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
  const wakeThreshold = useUserSettingsStore((s) => s.wakeThreshold);
  // 숨김 모드(아바타 hidden)면 웨이크워드/음성 사이클을 멈춘다 — 일정 알림만 유지.
  const avatarVisible = useUiStore((s) => s.avatarVisible);

  const startWakeListening = useCallback(async (threshold: number) => {
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
      await detector.listen(
        (result) => {
          console.info("[wake] detected! score=", result.wakeScore.toFixed(3));
          // 측정 모드에선 voice cycle을 발동시키지 않음 — TTS 인사가 측정을 흐리고
          // listener가 cycle 동안 정지하면 score 기록이 누락된다.
          // NDJSON에는 wakeword.ts에서 triggered:true로 그대로 기록.
          if (useUserSettingsStore.getState().wakeMeasurementMode) {
            console.info("[wake] cycle suppressed (measurement mode)");
            return;
          }
          void voiceRef.current?.wake();
        },
        { threshold },
      );
      wakeListeningRef.current = true;
      console.info("[wake] listening started, threshold=", threshold);
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

  // voice cycle 진행 중엔 wake listener를 일시 정지 — TTS 자기 음성에 wake가 트리거되는 문제 방지.
  // cycle 종료 시 voiceEnabled가 살아있으면 다시 시작.
  const voiceEnabledRef = useRef(voiceEnabled);
  const wakeThresholdRef = useRef(wakeThreshold);
  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);
  useEffect(() => {
    wakeThresholdRef.current = wakeThreshold;
  }, [wakeThreshold]);
  useEffect(() => {
    cycleHooksRef.current.start = () => {
      console.info("[voice] cycle start → pausing wake listener");
      void stopWakeListening();
    };
    cycleHooksRef.current.end = () => {
      console.info("[voice] cycle end → resuming wake listener");
      // 숨김 모드 중이면 사이클 종료 후 재청취하지 않음.
      if (voiceEnabledRef.current && useUiStore.getState().avatarVisible) {
        void startWakeListening(wakeThresholdRef.current);
      }
    };
  }, [startWakeListening, stopWakeListening]);

  useEffect(() => {
    // 숨김 모드(avatarVisible=false)에선 음성을 비활성화로 취급해 마이크/웨이크워드를 멈춘다.
    if (voiceEnabled && avatarVisible) {
      // threshold 변경 시 stop → start로 재시작 (listen 내부 closure 갱신).
      void (async () => {
        await stopWakeListening();
        await startWakeListening(wakeThreshold);
      })();
    } else {
      void stopWakeListening();
    }
    return () => {
      void stopWakeListening();
    };
  }, [
    voiceEnabled,
    avatarVisible,
    wakeThreshold,
    startWakeListening,
    stopWakeListening,
  ]);

  // wake 측정 모드 — ON일 때 NDJSON 세션을 열고 detector에 telemetry sink 설치.
  // OFF로 가면 sink 해제 + 세션 close. 스키마는 docs/DECISIONS.md D-012.
  const wakeMeasurementMode = useUserSettingsStore((s) => s.wakeMeasurementMode);
  useEffect(() => {
    if (!wakeMeasurementMode) return;

    const detector = getDetector();
    const sessionId = crypto.randomUUID();
    let active = true;

    void (async () => {
      // detector가 로드되어 있어야 wordLabels()가 의미 있음 (singleton이라 idempotent).
      try {
        await detector.init();
        await detector.load();
      } catch (e) {
        console.warn("[wake-measure] detector init failed", e);
        return;
      }
      if (!active) return;

      const sessionRecord = {
        type: "session",
        v: 1,
        session_id: sessionId,
        started_at: new Date().toISOString(),
        prod_commit_sha: __APP_COMMIT_SHA__,
        platform: {
          os: window.api.platform.os,
          arch: window.api.platform.arch,
          electron: window.api.versions.electron,
        },
        model: {
          backend: "speech-commands-tfjs",
          labels: detector.wordLabels(),
          threshold: useUserSettingsStore.getState().wakeThreshold,
          suppression_ms: 1500,
          overlap: 0.5,
        },
        audio_chunk_hash_algo: "sha256-hex16",
      };

      try {
        const r = await api.debugWakeLog({
          type: "open",
          sessionId,
          record: sessionRecord,
        });
        if (!active) return;
        console.info(`[wake-measure] session ${sessionId} → ${r.path}`);
      } catch (e) {
        console.warn("[wake-measure] open failed", e);
        return;
      }

      detector.setTelemetrySink((rec) => {
        if (!active) return;
        // append는 fire-and-forget. 실패해도 prod 동작에 영향 없음.
        void api
          .debugWakeLog({ type: "append", sessionId, record: rec })
          .catch(() => {});
      });
    })();

    return () => {
      active = false;
      detector.setTelemetrySink(null);
      void api
        .debugWakeLog({ type: "close", sessionId })
        .catch(() => {});
    };
  }, [wakeMeasurementMode]);

  return (
    <div className="relative h-screen w-screen">
      <AvatarShell />
    </div>
  );
}

export default AvatarApp;
