export interface RecorderResult {
  base64: string;
  mime: string;
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
    return { base64: bytesToBase64(new Uint8Array(buffer)), mime };
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
    let firstVoiceAt: number | null = null;
    let lastVoiceAt: number | null = null;
    let consecutiveVoiceFrames = 0;
    // 연속 voice 프레임이 이 값 이상이어야 "진짜 발화" 시작으로 인정.
    // ~6 프레임 ≈ 100ms (60fps 기준). 짧은 spike(키보드/숨소리) 무시.
    const VOICE_ONSET_FRAMES = 6;
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

      const isVoice = rms > cfg.thresholdRms;
      if (isVoice) {
        consecutiveVoiceFrames += 1;
      } else {
        consecutiveVoiceFrames = 0;
      }

      if (firstVoiceAt === null) {
        if (consecutiveVoiceFrames >= VOICE_ONSET_FRAMES) {
          firstVoiceAt = now;
          lastVoiceAt = now;
        }
      } else if (isVoice) {
        lastVoiceAt = now;
      }

      if (now - recordStart > cfg.maxDurationMs) {
        trigger("max_duration");
        return;
      }

      if (firstVoiceAt === null) {
        if (now - recordStart > cfg.initialWaitMs) {
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
