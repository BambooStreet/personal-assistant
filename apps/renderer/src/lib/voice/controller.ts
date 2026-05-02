import { playBase64, type PlayHandle } from "../audio";
import { Recorder } from "../recorder";
import { api } from "../runtime";
import { useUiStore } from "../../stores/useUiStore";

// 상태 머신 — wake 트리거부터 응답 발화 종료까지의 한 사이클을 관리.
//
//   idle ─ wake ─▶ attentive (인사) ─▶ listening (VAD 캡처)
//                                          │
//                                          ▼
//                                      thinking (STT + chat)
//                                          │
//                                          ▼
//                                      speaking (응답 TTS)
//                                          │
//                                          ▼
//                                        idle
//
// 사이클이 진행 중일 때 wake가 다시 들어오면 무시.
// 어떤 단계에서든 실패하면 즉시 idle로 복귀.

export interface VoiceControllerOptions {
  greeting: () => Promise<{ b64: string; mime: string } | null>; // 캐시 또는 fresh
  voice: string; // tts.voice
  micDeviceId: string | null;
  onError?: (msg: string) => void;
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
}

type Phase = "idle" | "attentive" | "listening" | "thinking" | "speaking";

const setAvatar = (phase: Phase) => {
  // attentive 외엔 AvatarState와 1:1
  useUiStore.setState((s) => ({ ...s, avatarState: phase }));
  // 다른 윈도우에 broadcast (setAvatarState 액션 우회 — 무한루프 방지용)
  void import("../api").then((m) => m.default.windowSetAvatarState(phase));
};

export class VoiceController {
  private phase: Phase = "idle";
  private recorder: Recorder | null = null;
  private currentPlayback: PlayHandle | null = null;
  private opts: VoiceControllerOptions;

  constructor(opts: VoiceControllerOptions) {
    this.opts = opts;
  }

  updateOptions(patch: Partial<VoiceControllerOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  async wake(): Promise<void> {
    if (this.phase !== "idle") {
      console.info("[voice] wake ignored — phase=", this.phase);
      return;
    }
    try {
      await this.runCycle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[voice] cycle failed", e);
      this.opts.onError?.(msg);
    } finally {
      this.toIdle();
    }
  }

  cancel(): void {
    this.recorder?.cancel();
    this.recorder = null;
    this.currentPlayback?.stop();
    this.currentPlayback = null;
    this.toIdle();
  }

  private toIdle(): void {
    this.phase = "idle";
    setAvatar("idle");
  }

  private async runCycle(): Promise<void> {
    // 1) 인사
    this.phase = "attentive";
    setAvatar("attentive");
    const greet = await this.opts.greeting();
    if (greet) {
      await this.playAndWait(greet.b64, greet.mime);
    } else {
      // 인사 없을 때는 짧은 폴백 — 그냥 잠깐 대기
      await sleep(150);
    }

    // 2) 듣기
    this.phase = "listening";
    setAvatar("listening");
    const captured = await this.captureUserSpeech();
    if (!captured) {
      this.opts.onError?.("말소리가 감지되지 않았어요.");
      return;
    }

    // 3) STT
    this.phase = "thinking";
    setAvatar("thinking");
    const stt = await api.sttTranscribe(captured.base64, captured.mime);
    const text = stt.text.trim();
    if (!text) {
      this.opts.onError?.("음성에서 글자를 인식하지 못했어요.");
      return;
    }
    this.opts.onTranscript?.(text);

    // 4) Chat
    const turn = await api.chatSend(text);
    const reply = (turn.assistant_text ?? "").trim();
    if (reply) this.opts.onResponse?.(reply);
    if (!reply) return;

    // 5) 응답 TTS
    this.phase = "speaking";
    setAvatar("speaking");
    const out = await api.ttsSpeak(reply, this.opts.voice);
    await this.playAndWait(out.audio_b64, out.mime);
  }

  private async captureUserSpeech(): Promise<{ base64: string; mime: string } | null> {
    return new Promise<{ base64: string; mime: string } | null>(
      (resolve, reject) => {
        const rec = new Recorder();
        this.recorder = rec;
        let stopped = false;
        const finalize = async () => {
          if (stopped) return;
          stopped = true;
          try {
            const result = await rec.stop();
            this.recorder = null;
            resolve(result);
          } catch (e) {
            this.recorder = null;
            reject(e);
          }
        };
        rec
          .start(this.opts.micDeviceId, {
            silenceMs: 1500,
            initialWaitMs: 6_000,
            maxDurationMs: 30_000,
            thresholdRms: 0.04,
            onAutoStop: () => void finalize(),
          })
          .catch((e) => {
            this.recorder = null;
            reject(e);
          });
      },
    );
  }

  private async playAndWait(b64: string, mime: string): Promise<void> {
    const handle = await playBase64(b64, mime);
    this.currentPlayback = handle;
    await new Promise<void>((resolve) => {
      const audio = handle.audio;
      const done = () => {
        audio.removeEventListener("ended", done);
        audio.removeEventListener("error", done);
        resolve();
      };
      audio.addEventListener("ended", done);
      audio.addEventListener("error", done);
    });
    this.currentPlayback = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
