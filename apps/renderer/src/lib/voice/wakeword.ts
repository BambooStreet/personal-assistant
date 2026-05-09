// @tensorflow-models/speech-commands 기반 wake word 인식기.
// 베이스 모델은 Google의 Speech Commands 18w (BROWSER_FFT). 그 위에 transfer head를 학습.
// 큰 의존(tfjs ~5MB + speech-commands)은 동적 import로 늦게 로드.

import type {
  SpeechCommandRecognizer,
  TransferSpeechCommandRecognizer,
  SpeechCommandRecognizerResult,
} from "@tensorflow-models/speech-commands";

const MODEL_NAME = "personal-assistant-wake";
const STORAGE_KEY = `indexeddb://${MODEL_NAME}`;
const LABELS_STORAGE_KEY = `${MODEL_NAME}-labels`;
export const POSITIVE_LABEL = "wake";
export const NOISE_LABEL = "_background_noise_";
export const UNKNOWN_LABEL = "_unknown_";

export interface TrainParams {
  epochs: number;
  batchSize: number;
  validationSplit: number;
}

export const DEFAULT_TRAIN_PARAMS: TrainParams = {
  epochs: 30,
  batchSize: 16,
  validationSplit: 0.15,
};

export interface DetectionResult {
  wakeScore: number;
  scores: Record<string, number>;
}

// 측정 모드 텔레메트리 — wake 검출 베이스라인 분석용. 스키마는 docs/DECISIONS.md D-012.
// 매 inference frame마다 호출. detector가 raw spectrogram에 접근 가능한 위치에서
// 해시까지 계산해 record를 만든다.
export interface TelemetryRecord {
  type: "score";
  t_ms: number;
  scores: Record<string, number>;
  audio_chunk_hash: string; // sha256 hex의 앞 16자 (8byte)
  triggered: boolean;
}

export type TelemetrySink = (rec: TelemetryRecord) => void;

async function sha256Hex16(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest, 0, 8);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

export interface ExampleCounts {
  [label: string]: number;
}

let baseRecognizer: SpeechCommandRecognizer | null = null;
let baseLoadPromise: Promise<SpeechCommandRecognizer> | null = null;

export type LoadStage = "module" | "create" | "weights" | "ready";

async function getBase(
  onStage?: (stage: LoadStage) => void,
): Promise<SpeechCommandRecognizer> {
  if (baseRecognizer) {
    onStage?.("ready");
    return baseRecognizer;
  }
  if (baseLoadPromise) return baseLoadPromise;
  baseLoadPromise = (async () => {
    const t0 = performance.now();
    onStage?.("module");
    const tf = await import("@tensorflow/tfjs");
    await tf.ready();
    const speech = await import("@tensorflow-models/speech-commands");
    console.info(`[wake] module import: ${(performance.now() - t0).toFixed(0)}ms`);
    onStage?.("create");
    const r = speech.create("BROWSER_FFT");
    console.info(`[wake] recognizer create: ${(performance.now() - t0).toFixed(0)}ms`);
    onStage?.("weights");
    await r.ensureModelLoaded();
    console.info(`[wake] weights loaded: ${(performance.now() - t0).toFixed(0)}ms`);
    baseRecognizer = r;
    onStage?.("ready");
    console.info(`[wake] ready — total: ${(performance.now() - t0).toFixed(0)}ms`);
    return r;
  })();
  return baseLoadPromise;
}

export class WakeWordDetector {
  private transfer: TransferSpeechCommandRecognizer | null = null;
  private listening = false;
  private lastDetectionAt = 0;
  private savedLabels: string[] = [];
  // 측정 모드 ON일 때만 set. listen()의 콜백 내부에서 매 frame 호출됨.
  private telemetrySink: TelemetrySink | null = null;

  setTelemetrySink(sink: TelemetrySink | null): void {
    this.telemetrySink = sink;
  }

  async init(onStage?: (stage: LoadStage) => void): Promise<void> {
    if (this.transfer) {
      onStage?.("ready");
      return;
    }
    const base = await getBase(onStage);
    this.transfer = base.createTransfer(MODEL_NAME);
  }

  exampleCounts(): ExampleCounts {
    try {
      return this.transfer?.countExamples() ?? {};
    } catch {
      return {};
    }
  }

  async collectExample(label: string): Promise<void> {
    if (!this.transfer) await this.init();
    await this.transfer!.collectExample(label, {
      durationSec: 1.0, // BROWSER_FFT는 1초 윈도우
    });
  }

  /** 한 번에 여러 샘플을 연속으로 수집할 때 사용 (UI에서 progress callback과 함께). */
  async collectMany(
    label: string,
    count: number,
    onProgress?: (i: number, total: number) => void,
  ): Promise<void> {
    if (!this.transfer) await this.init();
    for (let i = 0; i < count; i++) {
      await this.transfer!.collectExample(label, { durationSec: 1.0 });
      onProgress?.(i + 1, count);
    }
  }

  async clearExamples(): Promise<void> {
    if (!this.transfer) return;
    // 로드된 모델 상태가 꼬일 수 있으므로 transfer를 새로 생성.
    const base = await getBase();
    this.transfer = base.createTransfer(MODEL_NAME);
  }

  async train(
    params: Partial<TrainParams> = {},
    onEpoch?: (epoch: number, logs: { acc?: number; valAcc?: number }) => void,
  ): Promise<void> {
    if (!this.transfer) throw new Error("detector not initialized");
    const merged = { ...DEFAULT_TRAIN_PARAMS, ...params };
    await this.transfer.train({
      epochs: merged.epochs,
      batchSize: merged.batchSize,
      validationSplit: merged.validationSplit,
      callback: {
        onEpochEnd: async (epoch, logs) => {
          onEpoch?.(epoch, {
            acc: logs?.acc as number | undefined,
            valAcc: logs?.val_acc as number | undefined,
          });
        },
      },
    });
  }

  /** 학습된 transfer head를 IndexedDB에 영속화. */
  async save(): Promise<void> {
    if (!this.transfer) return;
    await this.transfer.save(STORAGE_KEY);
    // 라이브러리가 load 시 라벨을 복원하지 않는 버그 우회.
    const labels = this.transfer.wordLabels();
    if (labels.length > 0) {
      localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(labels));
      this.savedLabels = labels;
    }
  }

  /** 저장된 transfer head를 로드. 없으면 false. */
  async load(): Promise<boolean> {
    if (!this.transfer) await this.init();
    try {
      await this.transfer!.load(STORAGE_KEY);
      // 라벨 복원: localStorage → 라이브러리 → 기본값 순으로 폴백.
      const libLabels = this.transfer!.wordLabels?.() ?? [];
      const raw = localStorage.getItem(LABELS_STORAGE_KEY);
      const storedLabels = raw ? (JSON.parse(raw) as string[]) : [];
      if (libLabels.length > 0) {
        this.savedLabels = libLabels;
      } else if (storedLabels.length > 0) {
        this.savedLabels = storedLabels;
      } else {
        // 이전에 라벨 저장 없이 학습된 모델 — 알파벳순 기본값 적용.
        this.savedLabels = [NOISE_LABEL, UNKNOWN_LABEL, POSITIVE_LABEL];
        console.info("[wake] using default label order (legacy model)");
      }
      localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(this.savedLabels));
      return true;
    } catch (e) {
      console.info("[wake] no saved model", e);
      return false;
    }
  }

  wordLabels(): string[] {
    const libLabels = this.transfer?.wordLabels() ?? [];
    return libLabels.length > 0 ? libLabels : this.savedLabels;
  }

  isListening(): boolean {
    return this.listening;
  }

  /** 실시간 추론 시작. wake 점수가 threshold 초과 + suppressionMs 이내 중복 차단. */
  async listen(
    onWake: (result: DetectionResult) => void,
    options: { threshold?: number; suppressionMs?: number; overlap?: number } = {},
    onScore?: (result: DetectionResult) => void,
  ): Promise<void> {
    if (!this.transfer) throw new Error("detector not initialized");
    if (this.listening) return;
    const threshold = options.threshold ?? 0.85;
    const suppressionMs = options.suppressionMs ?? 1500;
    const overlap = options.overlap ?? 0.5;

    const labels = this.wordLabels();
    const wakeIdx = labels.indexOf(POSITIVE_LABEL);
    if (wakeIdx < 0) {
      throw new Error(`wake label '${POSITIVE_LABEL}' not found in trained model`);
    }

    await this.transfer.listen(
      async (raw: SpeechCommandRecognizerResult) => {
        const scoresArr = Array.from(raw.scores as Float32Array);
        const scores: Record<string, number> = {};
        labels.forEach((l, i) => (scores[l] = scoresArr[i]));
        const wakeScore = scores[POSITIVE_LABEL] ?? 0;
        const result: DetectionResult = { wakeScore, scores };
        onScore?.(result);
        const now = Date.now();
        const triggered =
          wakeScore >= threshold &&
          now - this.lastDetectionAt > suppressionMs;
        if (triggered) {
          this.lastDetectionAt = now;
          onWake(result);
        }
        // 측정 모드 텔레메트리 — sink 있을 때만. 해시 비용은 frame당 sub-ms.
        const sink = this.telemetrySink;
        if (sink && raw.spectrogram) {
          try {
            const buf = raw.spectrogram.data.buffer.slice(
              raw.spectrogram.data.byteOffset,
              raw.spectrogram.data.byteOffset +
                raw.spectrogram.data.byteLength,
            );
            const hash = await sha256Hex16(buf);
            sink({
              type: "score",
              t_ms: now,
              scores,
              audio_chunk_hash: hash,
              triggered,
            });
          } catch (e) {
            // 측정 실패는 prod 사이클을 막지 않음.
            console.warn("[wake] telemetry sink failed", e);
          }
        }
      },
      {
        probabilityThreshold: 0, // 직접 임계값 적용 (모든 결과 받기)
        invokeCallbackOnNoiseAndUnknown: true,
        overlapFactor: overlap,
        includeSpectrogram: true, // telemetry sink가 audio_chunk_hash를 만들기 위해
      },
    );
    this.listening = true;
  }

  async stopListen(): Promise<void> {
    if (!this.transfer || !this.listening) return;
    await this.transfer.stopListening();
    this.listening = false;
  }

  /** 학습되지 않은 baseline 호출 시 wake 라벨이 없으면 학습 필요. */
  isTrained(): boolean {
    return this.wordLabels().includes(POSITIVE_LABEL);
  }
}

let singleton: WakeWordDetector | null = null;

export function getDetector(): WakeWordDetector {
  if (!singleton) singleton = new WakeWordDetector();
  return singleton;
}
