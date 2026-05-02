import { Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { playBase64, type PlayHandle } from "../../lib/audio";
import { cn } from "../../lib/cn";
import { api } from "../../lib/runtime";
import {
  TTS_VOICES,
  useUserSettingsStore,
  type TtsVoice,
} from "../../stores/useUserSettingsStore";
import { WakeWordTrainer } from "./WakeWordTrainer";

const VOICE_LABELS: Record<TtsVoice, { label: string; hint: string }> = {
  alloy: { label: "Alloy", hint: "기본 · 중립적" },
  echo: { label: "Echo", hint: "차분한 남성톤" },
  fable: { label: "Fable", hint: "이야기꾼톤" },
  onyx: { label: "Onyx", hint: "낮고 묵직" },
  nova: { label: "Nova", hint: "밝은 여성톤" },
  shimmer: { label: "Shimmer", hint: "부드러움" },
};

const SAMPLE_TEXT =
  "안녕하세요. 오늘은 무엇을 도와드릴까요? 일정과 할 일을 함께 살펴봐요.";

export function VoiceSettingsPanel() {
  const voice = useUserSettingsStore((s) => s.voice);
  const setVoice = useUserSettingsStore((s) => s.setVoice);
  const autoPlay = useUserSettingsStore((s) => s.autoPlayBriefing);
  const setAutoPlay = useUserSettingsStore((s) => s.setAutoPlayBriefing);
  const loaded = useUserSettingsStore((s) => s.loaded);
  const load = useUserSettingsStore((s) => s.load);

  const [previewing, setPreviewing] = useState<TtsVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handleRef = useRef<PlayHandle | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    return () => {
      handleRef.current?.stop();
    };
  }, []);

  const stop = () => {
    handleRef.current?.stop();
    handleRef.current = null;
    setPreviewing(null);
  };

  const preview = async (v: TtsVoice) => {
    if (busy) return;
    stop();
    setBusy(true);
    setErr(null);
    try {
      const out = await api.ttsSpeak(SAMPLE_TEXT, v);
      const h = await playBase64(out.audio_b64, out.mime);
      handleRef.current = h;
      setPreviewing(v);
      h.audio.addEventListener("ended", () => {
        setPreviewing(null);
        handleRef.current = null;
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <h3 className="text-sm font-semibold">음성</h3>

      <section className="space-y-1.5">
        <p className="text-[11px] text-fg-muted">비서 목소리</p>
        <ul className="space-y-1">
          {TTS_VOICES.map((v) => {
            const meta = VOICE_LABELS[v];
            const selected = voice === v;
            const isPreviewing = previewing === v;
            return (
              <li
                key={v}
                className={cn(
                  "no-drag flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
                  selected
                    ? "border-accent/40 bg-accent/10"
                    : "border-white/5 bg-bg-elevated/40 hover:bg-bg-elevated/70",
                )}
              >
                <button
                  type="button"
                  onClick={() => void setVoice(v)}
                  className="flex-1 text-left"
                >
                  <p className="text-[12px] font-medium">{meta.label}</p>
                  <p className="text-[10px] text-fg-subtle">{meta.hint}</p>
                </button>
                <button
                  type="button"
                  disabled={busy && !isPreviewing}
                  onClick={() =>
                    isPreviewing ? stop() : void preview(v)
                  }
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
                  aria-label={isPreviewing ? "정지" : "미리듣기"}
                  title={isPreviewing ? "정지" : "미리듣기"}
                >
                  {isPreviewing ? <Square size={11} /> : <Play size={11} />}
                </button>
                {selected && (
                  <span className="text-[10px] text-accent">선택됨</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-md border border-white/5 bg-bg-elevated/40 p-2.5">
        <label className="flex items-center justify-between text-xs">
          <span>
            <span className="font-medium">브리핑 자동 재생</span>
            <span className="ml-2 text-[10px] text-fg-subtle">
              그날 첫 실행 시
            </span>
          </span>
          <input
            type="checkbox"
            className="no-drag h-4 w-4 accent-accent"
            checked={autoPlay}
            onChange={(e) => void setAutoPlay(e.target.checked)}
          />
        </label>
      </section>

      <WakeWordTrainer />

      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
          {err}
        </div>
      )}
    </div>
  );
}
