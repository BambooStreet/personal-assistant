import { playBase64, type PlayHandle } from "../audio";
import { Recorder } from "../recorder";
import { api, type ChatTurn } from "../api";
import { useUiStore } from "../../stores/useUiStore";

// 상태 머신 — wake 트리거부터 응답 발화 종료까지의 사이클을 관리.
//
//   idle ─ wake ─▶ attentive (인사) ─▶ listening (VAD 캡처)
//                                          │
//                                          ▼
//                                      thinking (STT + chat)
//                                          │
//                                          ▼
//                                      speaking (응답 TTS)
//                                          │
//                                ┌─────────┴─────────┐
//                                │ followup OFF       │
//                                ▼                    ▼
//                              idle      followup-listening (짧은 wait)
//                                                  │
//                                              (음성 캡처되면 → thinking → speaking → 다시)
//                                              (침묵 timeout이면 → idle)
//
// 사이클이 진행 중일 때 wake가 다시 들어오면 무시.
// 어떤 단계에서든 실패하면 즉시 idle로 복귀.
// pending tool(write 도구 confirm 필요)이 있으면 followup 진입 안 함.

export interface VadParams {
  thresholdRms: number;
  silenceMs: number;
  initialWaitMs: number;
}

export interface VoiceControllerOptions {
  greeting: () => Promise<{ b64: string; mime: string } | null>; // 캐시 또는 fresh
  voice: string; // tts.voice
  micDeviceId: string | null;
  // 첫 listening (wake 후) VAD 파라미터.
  initialVad: VadParams;
  // followup listening VAD 파라미터 (보통 더 짧음).
  followupVad: VadParams & { maxDurationMs: number };
  followupEnabled: boolean;
  onError?: (msg: string) => void;
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  /** voice cycle 시작 시 호출 — wake listener 일시 정지 등에 사용. */
  onCycleStart?: () => void;
  /** voice cycle 종료 시 호출 — wake listener 재개. */
  onCycleEnd?: () => void;
  /** wake() 진입 시 호출 (speakSequence는 제외). 채팅 로그에 호출/인사 추가용. */
  onWakeBegin?: () => void;
}

// 발화 최소 지속 시간. 이보다 짧으면 STT 스킵 (Whisper hallucination 방지).
const MIN_SPEECH_MS = 800;

// Whisper가 무음/짧은 입력에 종종 환각하는 문구들. 정확히 매칭되면 발화 없음 처리.
const HALLUCINATION_PHRASES: string[] = [
  "시청해 주셔서 감사합니다",
  "시청해주셔서 감사합니다",
  "감사합니다",
  "구독과 좋아요 부탁드립니다",
  "구독 좋아요 부탁드립니다",
  "MBC 뉴스",
  "Thanks for watching",
  "Thank you for watching",
  "Thank you.",
  "Bye.",
  "Bye!",
];

function isHallucination(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  // 매우 짧은 일반 응답("네", "응" 등)도 의미 있을 수 있어서 환각 phrase만 정확히 비교.
  for (const p of HALLUCINATION_PHRASES) {
    if (t === p) return true;
  }
  return false;
}

// 사용자가 "그만/됐어/고마워" 등을 말하면 LLM 호출 없이 followup 즉시 종료.
// 정확히 매칭되거나 짧은 변형만 처리 — "그만 해줘" 같은 LLM 요청은 정상 처리되도록 보수적.
const TERMINATION_PHRASES: string[] = [
  "그만",
  "그만해",
  "그만하자",
  "됐어",
  "됐어요",
  "됐다",
  "고마워",
  "고마워요",
  "고맙다",
  "고맙습니다",
  "감사",
  "끝",
  "끝!",
  "잘 자",
  "잘자",
  "안녕",
  "바이",
  "이제 됐어",
];

function isTerminationIntent(text: string): boolean {
  const stripped = text
    .replace(/[.,!?\s　]+/g, "")
    .toLowerCase();
  for (const p of TERMINATION_PHRASES) {
    const norm = p.replace(/[.,!?\s　]+/g, "").toLowerCase();
    if (stripped === norm) return true;
  }
  return false;
}

// 도구 confirm 단계의 yes/no 분류. 짧은 응답만 정확히 매칭 — 모호하면 unclear로 fallback.
const YES_PHRASES: string[] = [
  "예", "네", "응", "어", "그래", "그래요", "좋아", "좋아요",
  "ok", "오케이", "okay", "yes",
  "추가", "추가해", "추가해줘", "저장", "저장해", "저장해줘",
  "해", "해줘", "해주세요", "맞아", "맞아요", "응응", "응!",
];
const NO_PHRASES: string[] = [
  "아니", "아니요", "아냐", "안", "안돼", "안 돼",
  "취소", "취소해", "싫어", "싫어요",
  "no", "노", "말고", "말아", "말아줘",
  "하지마", "하지 마", "그만", "됐어",
];

function classifyYesNo(text: string): "confirm" | "reject" | "unclear" {
  const t = text.replace(/[.,!?\s　]+/g, "").toLowerCase();
  const hit = (list: string[]) =>
    list.some((p) => {
      const n = p.replace(/[.,!?\s　]+/g, "").toLowerCase();
      return t === n || (t.length <= n.length + 4 && t.startsWith(n));
    });
  if (hit(YES_PHRASES)) return "confirm";
  if (hit(NO_PHRASES)) return "reject";
  return "unclear";
}

type Phase =
  | "idle"
  | "attentive"
  | "listening"
  | "followup-listening"
  | "thinking"
  | "speaking";

const setAvatar = (phase: Phase) => {
  // followup-listening은 시각적으로 listening과 동일.
  const visualPhase: Exclude<Phase, "followup-listening"> =
    phase === "followup-listening" ? "listening" : phase;
  useUiStore.setState((s) => ({ ...s, avatarState: visualPhase }));
  void api.windowSetAvatarState(visualPhase);
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
    this.opts.onCycleStart?.();
    this.opts.onWakeBegin?.();
    try {
      // 1) 인사
      this.phase = "attentive";
      setAvatar("attentive");
      const greet = await this.opts.greeting();
      if (greet) {
        await this.playAndWait(greet.b64, greet.mime);
      } else {
        await sleep(150);
      }

      // 2) 첫 turn (긴 initial wait)
      let isFollowup = false;
      while (true) {
        const result = await this.runConversationTurn(isFollowup);
        if (result === "no-input" || result === "pending-tool" || result === "no-reply") {
          break;
        }
        if (!this.opts.followupEnabled) break;
        isFollowup = true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[voice] cycle failed", e);
      this.opts.onError?.(msg);
    } finally {
      this.toIdle();
      this.opts.onCycleEnd?.();
    }
  }

  // 인사+브리핑 등 듣기/사고 단계 없이 TTS 두 번을 attentive→speaking으로 재생.
  // 하루 첫 실행 voice cycle 용도.
  async speakSequence(seq: {
    greetingAudio?: { b64: string; mime: string } | null;
    briefingAudio?: { b64: string; mime: string } | null;
  }): Promise<void> {
    if (this.phase !== "idle") {
      console.info("[voice] speakSequence ignored — phase=", this.phase);
      return;
    }
    this.opts.onCycleStart?.();
    try {
      if (seq.greetingAudio) {
        this.phase = "attentive";
        setAvatar("attentive");
        await this.playAndWait(seq.greetingAudio.b64, seq.greetingAudio.mime);
      }
      if (seq.briefingAudio) {
        this.phase = "speaking";
        setAvatar("speaking");
        await this.playAndWait(seq.briefingAudio.b64, seq.briefingAudio.mime);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[voice] speakSequence failed", e);
      this.opts.onError?.(msg);
    } finally {
      this.toIdle();
      this.opts.onCycleEnd?.();
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

  /**
   * 한 turn(listening → thinking → speaking)을 실행.
   * @returns
   *  - "no-input": 침묵으로 자동 종료 (= idle 전이)
   *  - "no-reply": LLM 응답 텍스트 없음 (= idle 전이)
   *  - "pending-tool": LLM이 write 도구 호출 → followup 진입 금지 (= idle 전이)
   *  - "completed": 정상 응답 → followup 진입 가능
   */
  private async runConversationTurn(
    isFollowup: boolean,
  ): Promise<"no-input" | "no-reply" | "pending-tool" | "completed"> {
    // listening
    this.phase = isFollowup ? "followup-listening" : "listening";
    setAvatar(this.phase);
    const captured = await this.captureUserSpeech(isFollowup);
    if (!captured) {
      if (!isFollowup) {
        this.opts.onError?.("말소리가 감지되지 않았어요.");
      }
      return "no-input";
    }
    // 짧은 발화는 Whisper hallucination 위험이 커서 STT 스킵.
    if (captured.speechMs < MIN_SPEECH_MS) {
      console.info(
        `[voice] short capture skipped — speechMs=${captured.speechMs.toFixed(0)} < ${MIN_SPEECH_MS}`,
      );
      return "no-input";
    }

    // STT
    this.phase = "thinking";
    setAvatar("thinking");
    const stt = await api.sttTranscribe(captured.base64, captured.mime);
    const text = stt.text.trim();
    if (!text || isHallucination(text)) {
      if (text) {
        console.info(`[voice] hallucination filtered: "${text}"`);
      } else {
        this.opts.onError?.("음성에서 글자를 인식하지 못했어요.");
      }
      return "no-reply";
    }
    if (isTerminationIntent(text)) {
      console.info(`[voice] termination intent detected: "${text}"`);
      return "no-input";
    }
    this.opts.onTranscript?.(text);

    // Chat
    const turn: ChatTurn = await api.chatSend(text);
    const reply = (turn.assistant_text ?? "").trim();
    if (reply) this.opts.onResponse?.(reply);

    // TTS (응답 텍스트가 있으면)
    if (reply) {
      this.phase = "speaking";
      setAvatar("speaking");
      const out = await api.ttsSpeak(reply, this.opts.voice);
      await this.playAndWait(out.audio_b64, out.mime);
    }

    if (turn.tool_calls.length > 0) {
      const tool = turn.tool_calls[0];
      // 응답 텍스트 없었으면 "이대로 진행할까요?" 프롬프트 추가 재생.
      if (!reply) {
        try {
          this.phase = "speaking";
          setAvatar("speaking");
          const out = await api.ttsSpeak("이대로 진행할까요?", this.opts.voice);
          await this.playAndWait(out.audio_b64, out.mime);
        } catch (e) {
          console.warn("[voice] confirm prompt TTS failed", e);
        }
      }
      // 짧은 응답 캡처 후 yes/no 분류.
      const decision = await this.captureConfirmResponse();
      console.info(`[voice] tool confirm decision: ${decision}`);
      if (decision === "confirm") {
        void api.windowBroadcast("voice.toolConfirmRequested", {
          tool_call_id: tool.id,
        });
      } else if (decision === "reject") {
        void api.windowBroadcast("voice.toolRejectRequested", {
          tool_call_id: tool.id,
        });
      }
      // unclear면 broadcast 없음 → panel UI confirm 카드 그대로 사용 가능.
      return "pending-tool";
    }
    if (!reply) {
      return "no-reply";
    }
    return "completed";
  }

  // 짧은 yes/no 응답 캡처. followup VAD 사용 (짧은 wait + 짧은 silence).
  // 결과 텍스트를 yes/no로 분류해 반환.
  private async captureConfirmResponse(): Promise<
    "confirm" | "reject" | "unclear"
  > {
    this.phase = "followup-listening";
    setAvatar("followup-listening");
    let captured: { base64: string; mime: string; speechMs: number } | null;
    try {
      captured = await this.captureUserSpeech(true);
    } catch (e) {
      console.warn("[voice] confirm capture failed", e);
      return "unclear";
    }
    if (!captured || captured.speechMs < 300) return "unclear";
    try {
      const stt = await api.sttTranscribe(captured.base64, captured.mime);
      const text = stt.text.trim();
      if (!text || isHallucination(text)) return "unclear";
      console.info(`[voice] confirm response: "${text}"`);
      return classifyYesNo(text);
    } catch (e) {
      console.warn("[voice] confirm STT failed", e);
      return "unclear";
    }
  }

  private async captureUserSpeech(
    isFollowup: boolean,
  ): Promise<{ base64: string; mime: string; speechMs: number } | null> {
    const params = isFollowup ? this.opts.followupVad : this.opts.initialVad;
    const maxDurationMs = isFollowup
      ? this.opts.followupVad.maxDurationMs
      : 30_000;
    return new Promise<{ base64: string; mime: string; speechMs: number } | null>(
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
            silenceMs: params.silenceMs,
            initialWaitMs: params.initialWaitMs,
            maxDurationMs,
            thresholdRms: params.thresholdRms,
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
