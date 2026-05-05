import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { Recorder, type AutoStopReason } from "../../lib/recorder";
import { api } from "../../lib/api";
import { useUiStore } from "../../stores/useUiStore";
import { useUserSettingsStore } from "../../stores/useUserSettingsStore";

interface Props {
  disabled?: boolean;
  onTranscribed: (text: string) => void;
  onError?: (message: string | null) => void;
}

export function MicButton({ disabled, onTranscribed, onError }: Props) {
  const recorderRef = useRef<Recorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const finishingRef = useRef(false);
  const setAvatarState = useUiStore((s) => s.setAvatarState);
  const micDeviceId = useUserSettingsStore((s) => s.micDeviceId);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
    };
  }, []);

  const fail = (msg: string) => {
    console.error("[pa] mic", msg);
    onError?.(msg);
  };

  const finish = async (autoReason?: AutoStopReason) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const rec = recorderRef.current;
    if (!rec) {
      finishingRef.current = false;
      return;
    }
    setBusy(true);
    setRecording(false);
    try {
      const result = await rec.stop();
      if (!result) {
        if (autoReason === "no_speech_initial") {
          fail("말소리가 감지되지 않았어요.");
        } else {
          fail("녹음 결과가 비어 있어요. 더 길게 말해 주세요.");
        }
        return;
      }
      console.info("[pa] mic stop", {
        mime: result.mime,
        bytes_b64: result.base64.length,
        auto: autoReason ?? null,
      });
      const out = await api.sttTranscribe(result.base64, result.mime);
      console.info("[pa] stt result", {
        text_len: out.text.length,
        dur: out.duration_secs,
      });
      const text = out.text.trim();
      if (!text) {
        fail("음성에서 글자를 인식하지 못했어요.");
        return;
      }
      onTranscribed(text);
    } catch (e) {
      fail(`전사 실패: ${e}`);
    } finally {
      setAvatarState("idle");
      setBusy(false);
      finishingRef.current = false;
    }
  };

  const start = async () => {
    onError?.(null);
    if (!recorderRef.current) recorderRef.current = new Recorder();
    try {
      await recorderRef.current.start(micDeviceId, {
        silenceMs: 3000,
        initialWaitMs: 10_000,
        maxDurationMs: 60_000,
        thresholdRms: 0.04,
        onAutoStop: (reason) => {
          console.info("[pa] vad auto-stop", reason);
          void finish(reason);
        },
      });
      setRecording(true);
      setAvatarState("listening");
    } catch (e) {
      fail(`마이크 접근 실패: ${e}`);
      setRecording(false);
      setAvatarState("idle");
    }
  };

  const onClick = () => {
    if (disabled || busy) return;
    if (recording) void finish();
    else void start();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
        recording
          ? "bg-red-500/80 text-white animate-pulse"
          : busy
            ? "bg-bg-elevated text-fg-subtle"
            : "bg-bg-elevated/60 text-fg-muted hover:bg-bg-elevated hover:text-fg",
        (disabled || busy) && "cursor-not-allowed opacity-60",
      )}
      aria-label={recording ? "녹음 중 · 클릭해 종료" : "녹음 시작"}
      title={
        recording
          ? "녹음 중 · 3초 침묵 시 자동 종료"
          : "마이크 — 말하면 자동 인식"
      }
    >
      {recording ? <Mic size={14} /> : <MicOff size={14} />}
    </button>
  );
}
