import { Mic, Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";

interface Props {
  deviceId: string | null;
}

export function MicTester({ deviceId }: Props) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const cleanupRef = useRef<(() => void) | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedMimeRef = useRef<string>("audio/webm");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordTimerRef = useRef<number | null>(null);

  const stopMeter = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setActive(false);
    setLevel(0);
  };

  const startMeter = async () => {
    setErr(null);
    try {
      const validId = deviceId && deviceId.trim().length > 0 ? deviceId : null;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: validId ? { deviceId: { exact: validId } } : true,
      });

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) throw new Error("AudioContext 미지원");
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const loop = () => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const normalized = Math.min(1, rms * 4);
        setLevel(normalized);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        try {
          source.disconnect();
        } catch {
          /* ignore */
        }
        void audioCtx.close();
        stream.getTracks().forEach((t) => t.stop());
      };
      setActive(true);
    } catch (e) {
      setErr(`마이크 접근 실패: ${e}`);
    }
  };

  // device 변경 시 미터가 켜져있으면 재시작
  useEffect(() => {
    if (active) {
      stopMeter();
      void startMeter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      if (recordTimerRef.current) window.clearTimeout(recordTimerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setErr(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    try {
      const validId = deviceId && deviceId.trim().length > 0 ? deviceId : null;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: validId ? { deviceId: { exact: validId } } : true,
      });
      const mime = pickMime();
      recordedMimeRef.current = mime;
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          setRecordedUrl(url);
        }
        setRecording(false);
        recorderRef.current = null;
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);

      recordTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 3000);
    } catch (e) {
      setErr(`녹음 시작 실패: ${e}`);
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (recordTimerRef.current) {
      window.clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
  };

  const togglePlayback = () => {
    if (!recordedUrl) return;
    if (audioRef.current && playing) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    const audio = new Audio(recordedUrl);
    audioRef.current = audio;
    setPlaying(true);
    audio.addEventListener("ended", () => setPlaying(false));
    audio.addEventListener("error", () => setPlaying(false));
    void audio.play().catch((e) => {
      setErr(`재생 실패: ${e}`);
      setPlaying(false);
    });
  };

  return (
    <div className="rounded-md border border-line bg-bg-elevated/40 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">마이크 테스트</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => (active ? stopMeter() : void startMeter())}
            className="no-drag inline-flex items-center gap-1 rounded-md bg-bg/60 px-2 py-1 text-[10px] text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            {active ? <Square size={10} /> : <Mic size={10} />}
            {active ? "정지" : "레벨 보기"}
          </button>
        </div>
      </div>

      <LevelBar level={level} active={active} />

      <p className="mt-1 text-[10px] leading-relaxed text-fg-subtle">
        {active
          ? "말해보세요. 막대가 움직이면 마이크 입력이 정상입니다."
          : "선택한 마이크에서 소리를 받는지 확인합니다."}
      </p>

      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() =>
            recording ? stopRecording() : void startRecording()
          }
          className={cn(
            "no-drag inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
            recording
              ? "bg-red-500/80 text-white animate-pulse"
              : "bg-accent/80 text-bg",
          )}
        >
          {recording ? <Square size={11} /> : <Mic size={11} />}
          {recording ? "녹음 중지" : "3초 녹음"}
        </button>
        {recordedUrl && (
          <button
            type="button"
            onClick={togglePlayback}
            className="no-drag inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            {playing ? <Pause size={11} /> : <Play size={11} />}
            {playing ? "정지" : "재생"}
          </button>
        )}
      </div>

      {err && (
        <p className="mt-1.5 text-[11px] text-red-300">{err}</p>
      )}
    </div>
  );
}

function LevelBar({ level, active }: { level: number; active: boolean }) {
  const pct = Math.round(level * 100);
  const color =
    level > 0.85
      ? "bg-red-400"
      : level > 0.5
        ? "bg-amber-300"
        : "bg-emerald-400";
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg/60">
      <div
        className={cn(
          "h-full transition-[width] duration-75",
          active ? color : "bg-fg-subtle/40",
        )}
        style={{ width: `${active ? pct : 0}%` }}
      />
    </div>
  );
}

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c)
    ) {
      return c;
    }
  }
  return "audio/webm";
}
