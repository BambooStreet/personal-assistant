import { Pause, Play, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { playBase64, type PlayHandle } from "../../lib/audio";
import { api } from "../../lib/api";
import { useBriefingStore } from "../../stores/useBriefingStore";
import { useUiStore } from "../../stores/useUiStore";
import { useUserSettingsStore } from "../../stores/useUserSettingsStore";

export function BriefingCard() {
  const briefing = useBriefingStore((s) => s.briefing);
  const loading = useBriefingStore((s) => s.loading);
  const dismissed = useBriefingStore((s) => s.dismissed);
  const error = useBriefingStore((s) => s.error);
  const refresh = useBriefingStore((s) => s.refresh);
  const dismiss = useBriefingStore((s) => s.dismiss);
  const consumeAutoPlay = useBriefingStore((s) => s.consumeAutoPlay);

  const setAvatarState = useUiStore((s) => s.setAvatarState);
  const voice = useUserSettingsStore((s) => s.voice);
  const autoPlayBriefing = useUserSettingsStore((s) => s.autoPlayBriefing);

  const [playing, setPlaying] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const handleRef = useRef<PlayHandle | null>(null);

  const stopAudio = () => {
    handleRef.current?.stop();
    handleRef.current = null;
    setPlaying(false);
    setAvatarState("idle");
  };

  const playAudio = async (text: string) => {
    if (audioBusy || playing) return;
    setAudioBusy(true);
    try {
      const out = await api.ttsSpeak(text, voice);
      const h = await playBase64(out.audio_b64, out.mime);
      handleRef.current = h;
      setPlaying(true);
      setAvatarState("speaking");
      h.audio.addEventListener("ended", () => {
        setPlaying(false);
        setAvatarState("idle");
        handleRef.current = null;
      });
    } catch (e) {
      console.error("[pa] briefing tts failed", e);
      setAvatarState("idle");
    } finally {
      setAudioBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      handleRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (briefing && !dismissed && autoPlayBriefing && consumeAutoPlay()) {
      void playAudio(briefing.summary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefing, dismissed, autoPlayBriefing]);

  if (dismissed) return null;
  if (!briefing && !loading && !error) return null;

  return (
    <div className="rounded-md border border-violet-400/25 bg-violet-500/10 p-2.5 text-xs text-fg">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-violet-300">
          <Sparkles size={11} />
          <span>오늘의 한마디{briefing?.date ? ` · ${briefing.date}` : ""}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {briefing && (
            <button
              type="button"
              disabled={audioBusy}
              onClick={() =>
                playing ? stopAudio() : void playAudio(briefing.summary)
              }
              className="no-drag inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
              aria-label={playing ? "정지" : "재생"}
              title={playing ? "재생 정지" : "음성 재생"}
            >
              {playing ? <Pause size={10} /> : <Play size={10} />}
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              stopAudio();
              void refresh();
            }}
            className="no-drag inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
            aria-label="새로고침"
            title="다시 생성"
          >
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={() => {
              stopAudio();
              dismiss();
            }}
            className="no-drag inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-elevated hover:text-fg"
            aria-label="닫기"
            title="이번 세션 닫기"
          >
            <X size={10} />
          </button>
        </div>
      </div>
      {loading && !briefing ? (
        <p className="text-[11px] text-fg-muted">오늘의 한마디를 준비하고 있어요…</p>
      ) : briefing ? (
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg">
          {briefing.summary}
        </p>
      ) : null}
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
