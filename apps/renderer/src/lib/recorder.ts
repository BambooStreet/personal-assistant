export interface RecorderResult {
  base64: string;
  mime: string;
  /** VAD가 인식한 발화 지속 시간 (firstVoice→lastVoice). 발화 미감지면 0. */
  speechMs: number;
}

export type AutoStopReason =
  | "silence_after_speech"
  | "no_speech_initial"
  | "max_duration";

export interface VadOptions {
  silenceMs?: number;
  initialWaitMs?: number;
  maxDurationMs?: number;
  thresholdRms?: number;
  onAutoStop?: (reason: AutoStopReason) => void;
}

const DEFAULT_VAD: Required<Omit<VadOptions, "onAutoStop">> = {
  silenceMs: 3000,
  initialWaitMs: 10_000,
  maxDurationMs: 60_000,
  thresholdRms: 0.025,
};

export class Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = "audio/webm";

  private audioCtx: AudioContext | null = null;
  private rafId: number | null = null;
  private vadFirstVoiceAt: number | null = null;
  private vadLastVoiceAt: number | null = null;

  async start(
    deviceId?: string | null,
    vad?: VadOptions,
  ): Promise<void> {
    if (this.recorder) return;
    const validId = deviceId && deviceId.trim().length > 0 ? deviceId : null;
    const audio: MediaTrackConstraints | true = validId
      ? { deviceId: { exact: validId } }
      : true;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    const mime = pickMime();
    this.mime = mime;
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    // timeslice는 의도적으로 빼둔다. 100ms 단위 chunks를 concat한 webm이
    // valid container가 안 되는 디코더(=Whisper)에서 첫 cluster만 처리되는 케이스가 있음.
    // chunks가 비는 race는 stop()에서 처리.
    this.recorder.start();

    if (vad && this.stream) {
      this.startVad(this.stream, vad);
    }
  }

  isActive(): boolean {
    return this.recorder?.state === "recording";
  }

  async stop(): Promise<RecorderResult | null> {
    this.stopVad();
    if (!this.recorder) return null;
    const recorder = this.recorder;
    const mime = this.mime;
    const stream = this.stream;

    // 중요: this.chunks를 여기서 비우지 않는다. recorder.stop() 직후 마지막
    // ondataavailable이 발화하면서 push되는 데이터를 잡기 위해서.
    const blob: Blob = await new Promise((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: mime }));
      };
      if (recorder.state !== "inactive") recorder.stop();
    });

    // blob을 만든 다음에 정리
    this.recorder = null;
    this.chunks = [];
    this.stream = null;
    stream?.getTracks().forEach((t) => t.stop());

    if (blob.size === 0) return null;
    const buffer = await blob.arrayBuffer();
    const speechMs =
      this.vadFirstVoiceAt !== null && this.vadLastVoiceAt !== null
        ? this.vadLastVoiceAt - this.vadFirstVoiceAt
        : 0;
    this.vadFirstVoiceAt = null;
    this.vadLastVoiceAt = null;
    return {
      base64: bytesToBase64(new Uint8Array(buffer)),
      mime,
      speechMs,
    };
  }

  cancel(): void {
    this.stopVad();
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = null;
    this.chunks = [];
    this.stream = null;
  }

  private startVad(stream: MediaStream, opts: VadOptions): void {
    const cfg = { ...DEFAULT_VAD, ...opts };
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.audioCtx = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const recordStart = performance.now();
    this.vadFirstVoiceAt = null;
    this.vadLastVoiceAt = null;
    let firstVoiceAt: number | null = null;
    let lastVoiceAt: number | null = null;
    let consecutiveVoiceFrames = 0;
    // 연속 voice 프레임이 이 값 이상이어야 "진짜 발화" 시작으로 인정.
    const VOICE_ONSET_FRAMES = 10;
    // 노이즈 floor 추적용 슬라이딩 윈도우. 발화 중에도 음절 사이 짧은 pause가
    // floor로 들어가 effective threshold가 ambient에 적응. 발화 끝나면 즉시
    // floor가 ambient 수준으로 떨어져 silence 감지가 정상 동작.
    const NOISE_WINDOW_MS = 1000;
    const NOISE_MARGIN = 3.0;
    type Sample = { ts: number; rms: number };
    const rmsHistory: Sample[] = [];
    let lastLogAt = 0;
    let stopped = false;

    const trigger = (reason: AutoStopReason) => {
      if (stopped) return;
      stopped = true;
      this.stopVad();
      opts.onAutoStop?.(reason);
    };

    const loop = () => {
      if (stopped) return;
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const now = performance.now();
      const elapsed = now - recordStart;

      // 슬라이딩 윈도우 갱신
      rmsHistory.push({ ts: now, rms });
      while (rmsHistory.length && rmsHistory[0].ts < now - NOISE_WINDOW_MS) {
        rmsHistory.shift();
      }
      let noiseFloor = Infinity;
      for (const s of rmsHistory) {
        if (s.rms < noiseFloor) noiseFloor = s.rms;
      }
      if (!isFinite(noiseFloor)) noiseFloor = 0;
      const effectiveThreshold = Math.max(
        cfg.thresholdRms,
        noiseFloor * NOISE_MARGIN,
      );

      const isVoice = rms > effectiveThreshold;
      if (isVoice) {
        consecutiveVoiceFrames += 1;
      } else {
        consecutiveVoiceFrames = 0;
      }

      // 1초마다 한 번씩 상태 로그 (디버깅용)
      if (now - lastLogAt > 1000) {
        lastLogAt = now;
        console.info(
          `[vad] rms=${rms.toFixed(4)} floor=${noiseFloor.toFixed(4)} eff=${effectiveThreshold.toFixed(4)} voice=${isVoice} firstVoice=${firstVoiceAt !== null}`,
        );
      }

      if (firstVoiceAt === null) {
        if (consecutiveVoiceFrames >= VOICE_ONSET_FRAMES) {
          firstVoiceAt = now;
          lastVoiceAt = now;
          this.vadFirstVoiceAt = now;
          this.vadLastVoiceAt = now;
        }
      } else if (isVoice) {
        lastVoiceAt = now;
        this.vadLastVoiceAt = now;
      }

      if (elapsed > cfg.maxDurationMs) {
        trigger("max_duration");
        return;
      }

      if (firstVoiceAt === null) {
        if (elapsed > cfg.initialWaitMs) {
          trigger("no_speech_initial");
          return;
        }
      } else if (
        lastVoiceAt !== null &&
        now - lastVoiceAt > cfg.silenceMs
      ) {
        trigger("silence_after_speech");
        return;
      }

      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopVad(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "audio/webm";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return btoa(binary);
}
