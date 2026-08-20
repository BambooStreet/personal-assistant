import { type CSSProperties, useEffect } from "react";

import { BottomPanel } from "./components/widget/BottomPanel";
import { api, type ChatTurn } from "./lib/api";
import { playBase64 } from "./lib/audio";
import { useAvatarSync } from "./lib/useAvatarSync";
import { useClickThrough } from "./lib/useClickThrough";
import { usePanelSync } from "./lib/usePanelSync";
import { useTheme } from "./lib/useTheme";
import { useAuthStore } from "./stores/useAuthStore";
import { useChatStore } from "./stores/useChatStore";
import { useUiStore } from "./stores/useUiStore";
import { useUserSettingsStore } from "./stores/useUserSettingsStore";

// panelWindow 전용 React tree. BottomPanel만 렌더, 윈도우 전체가 panel.
function PanelApp() {
  useClickThrough();
  usePanelSync();
  useAvatarSync();
  useTheme();

  const setMainTab = useUiStore((s) => s.setMainTab);
  const loadUserSettings = useUserSettingsStore((s) => s.load);
  const appendExternalTurn = useChatStore((s) => s.appendExternalTurn);
  const appendContinuedTurn = useChatStore((s) => s.appendContinuedTurn);
  const appendWakeCall = useChatStore((s) => s.appendWakeCall);
  const authStatus = useAuthStore((s) => s.status);
  const loadAuth = useAuthStore((s) => s.load);
  const markAuthRequired = useAuthStore((s) => s.markRequired);

  // 부팅 시 인증 상태 로드(로컬 모드면 즉시 signed_in).
  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  // 세션 만료/무효 시 로그인 화면으로.
  useEffect(() => {
    const off = api.on("auth.required", () => markAuthRequired());
    return () => off();
  }, [markAuthRequired]);

  // PanelApp은 별도 React tree라 store 인스턴스가 분리됨 — 로그인 후에만 settings 로드.
  useEffect(() => {
    if (authStatus === "signed_in") void loadUserSettings();
  }, [authStatus, loadUserSettings]);

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

  // 일정 임박 알림. core 스케줄러가 fire하면 main이 OS 토스트 + 양쪽 윈도우에 broadcast.
  // PanelApp 한쪽에서만 처리 (아바타 윈도우와 양쪽이 받으면 TTS 두 번 발화). 다른 사이클이
  // 점유 중이면 건드리지 않음 — 음성 사이클 중복 방지.
  useEffect(() => {
    const off = api.on("notification.fired", (data) => {
      const d = data as {
        kind?: unknown;
        summary?: unknown;
        tts_enabled?: unknown;
        duration_min?: unknown;
      };
      const kind =
        d.kind === "1h" || d.kind === "15m" || d.kind === "leave" ? d.kind : null;
      const summary = typeof d.summary === "string" ? d.summary : "";
      if (!kind) return;

      // 숨김 모드면 TTS/아바타 연출을 건너뛴다 — OS 토스트는 Main이 이미 띄움.
      if (!useUiStore.getState().avatarVisible) return;

      if (useUiStore.getState().avatarState !== "idle") return;

      const willSpeak = d.tts_enabled === true && summary.length > 0;
      if (willSpeak) {
        useUiStore.getState().setAvatarState("speaking");
        const durationMin = typeof d.duration_min === "number" ? d.duration_min : null;
        const phrase = kind === "1h"
          ? `1시간 후에 ${summary} 있어요`
          : kind === "15m"
            ? `15분 후에 ${summary} 있어요`
            : durationMin !== null
              ? `${summary} 가려면 지금 나가야 해요, 대중교통 ${durationMin}분 걸려요`
              : `${summary} 가려면 지금 나가야 해요`;
        const voice = useUserSettingsStore.getState().voice;
        void (async () => {
          try {
            const out = await api.ttsSpeak(phrase, voice);
            const handle = await playBase64(out.audio_b64, out.mime);
            // playBase64는 audio.play() 시작 시점에 resolve되므로 ended까지 대기 필요.
            await new Promise<void>((resolve) => {
              handle.audio.addEventListener("ended", () => resolve(), { once: true });
              handle.audio.addEventListener("error", () => resolve(), { once: true });
            });
          } catch (e) {
            console.warn("[notifications] tts failed", e);
          } finally {
            if (useUiStore.getState().avatarState === "speaking") {
              useUiStore.getState().setAvatarState("idle");
            }
          }
        })();
      } else {
        useUiStore.getState().setAvatarState("attentive");
        window.setTimeout(() => {
          if (useUiStore.getState().avatarState === "attentive") {
            useUiStore.getState().setAvatarState("idle");
          }
        }, 3000);
      }
    });
    return () => off();
  }, []);

  // 루틴 알림(`routine.fired`). 일정 알림과 달리 문구가 Core에서 이미 완성돼 오므로
  // 조립 분기가 없다 — message를 그대로 읽는다.
  // ⚠️ PanelApp에서만 구독한다 — broadcast는 모든 윈도우에 팬아웃하므로 아바타 윈도우도
  // 받으면 TTS가 두 번 발화된다(위 notification.fired와 같은 이유).
  useEffect(() => {
    const off = api.on("routine.fired", (data) => {
      const d = data as { message?: unknown; tts_enabled?: unknown };
      const message = typeof d.message === "string" ? d.message : "";

      // 숨김 모드면 TTS/아바타 연출을 건너뛴다 — OS 토스트는 Main이 이미 띄웠다.
      if (!useUiStore.getState().avatarVisible) return;
      if (useUiStore.getState().avatarState !== "idle") return;

      if (d.tts_enabled === true && message.length > 0) {
        useUiStore.getState().setAvatarState("speaking");
        const voice = useUserSettingsStore.getState().voice;
        void (async () => {
          try {
            const out = await api.ttsSpeak(message, voice);
            const handle = await playBase64(out.audio_b64, out.mime);
            await new Promise<void>((resolve) => {
              handle.audio.addEventListener("ended", () => resolve(), { once: true });
              handle.audio.addEventListener("error", () => resolve(), { once: true });
            });
          } catch (e) {
            console.warn("[routine] tts failed", e);
          } finally {
            if (useUiStore.getState().avatarState === "speaking") {
              useUiStore.getState().setAvatarState("idle");
            }
          }
        })();
      } else {
        useUiStore.getState().setAvatarState("attentive");
        window.setTimeout(() => {
          if (useUiStore.getState().avatarState === "attentive") {
            useUiStore.getState().setAvatarState("idle");
          }
        }, 3000);
      }
    });
    return () => off();
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

  // 패널 창은 불투명 + show()/hide()로 등장/퇴장한다. 과거의 opacity 페이드인
  // (panel-card-enter)은 불투명 창에선 "검은 배경 한 프레임 → 콘텐츠"로 보여 제거.
  // 창이 콘텐츠와 함께 통째로 나타나므로 별도 등장 애니메이션 불필요.
  return (
    <div
      className="relative h-screen w-screen"
      data-clickable="true"
    >
      {/* 창 최상단 끝까지 덮는 드래그 스트립. .panel-card를 ring으로 바꿔 헤더를 y=0에
          붙였어도, 일부 DPI/창 상태에서 맨 윗줄 몇 px가 드래그로 안 잡히는 경우가 있어
          명시적으로 보장한다. z-10으로 보더 위, h-1.5(6px)라 세로 가운데 정렬된 헤더
          버튼 hit 영역과 안 겹친다. */}
      <div
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
        className="absolute inset-x-0 top-0 z-10 h-1.5"
      />
      <BottomPanel />
    </div>
  );
}

export default PanelApp;
