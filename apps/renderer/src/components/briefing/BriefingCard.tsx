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
  const load = useBriefingStore((s) => s.load);

  const setAvatarState = useUiStore((s) => s.setAvatarState);
  const voice = useUserSettingsStore((s) => s.voice);

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

  // 오늘 것이 이미 있으면 가져온다. 생성은 Core가 부팅 시퀀스에서만 하므로
  // 여기서는 조회만 한다(D-025). 자동 재생도 하지 않는다 — 부팅 TTS는 AvatarApp 담당.
  useEffect(() => {
    void load();
  }, [load]);

  // 렌더러는 zod 런타임 parse를 하지 않으므로 구버전 Core에선 undefined일 수 있다.
  const goalLines = briefing?.goal_lines ?? [];

  if (dismissed) return null;
  if (!briefing && !loading && !error) return null;

  return (
    <div className="rounded-md border border-gold/30 bg-halo p-2.5 text-xs text-fg">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-display text-xs tracking-[0.14em] text-accent">
          <Sparkles size={12} />
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
        <p className="text-xs text-fg-muted">오늘의 한마디를 준비하고 있어요…</p>
      ) : briefing ? (
        <>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg">
            {briefing.summary}
          </p>
          {/* 오늘 해당하는 목표 루틴. Core가 결정론적으로 만든 줄이라 LLM 변덕이 없다.
              TTS는 summary만 읽는다 — 이 줄까지 읽으면 로봇 같고, 밤 루틴 알림이 이미 말해준다. */}
          {goalLines.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
              {goalLines.map((line) => (
                <p key={line} className="text-xs leading-relaxed text-fg-muted">
                  {line}
                </p>
              ))}
            </div>
          )}
        </>
      ) : null}
      {error && <p className="mt-1.5 text-xs text-rose">{error}</p>}
    </div>
  );
}
