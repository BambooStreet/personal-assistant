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
    onStage?.("module");
    const speech = await import("@tensorflow-models/speech-commands");
    onStage?.("create");
    const r = speech.create("BROWSER_FFT");
    onStage?.("weights");
    await r.ensureModelLoaded();
    baseRecognizer = r;
    onStage?.("ready");
    return r;
  })();
  return baseLoadPromise;
}

export class WakeWordDetector {
  private transfer: TransferSpeechCommandRecognizer | null = null;
  private listening = false;
  private lastDetectionAt = 0;

  async init(onStage?: (stage: LoadStage) => void): Promise<void> {
    if (this.transfer) {
      onStage?.("ready");
      return;
    }
    const base = await getBase(onStage);
    this.transfer = base.createTransfer(MODEL_NAME);
  }

  exampleCounts(): ExampleCounts {
    return this.transfer?.countExamples() ?? {};
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
    this.transfer.clearExamples();
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
  }

  /** 저장된 transfer head를 로드. 없으면 false. */
  async load(): Promise<boolean> {
    if (!this.transfer) await this.init();
    try {
      await this.transfer!.load(STORAGE_KEY);
      return true;
    } catch (e) {
      console.info("[wake] no saved model", e);
      return false;
    }
  }

  wordLabels(): string[] {
    return this.transfer?.wordLabels() ?? [];
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

    const labels = this.transfer.wordLabels();
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
        if (
          wakeScore >= threshold &&
          now - this.lastDetectionAt > suppressionMs
        ) {
          this.lastDetectionAt = now;
          onWake(result);
        }
      },
      {
        probabilityThreshold: 0, // 직접 임계값 적용 (모든 결과 받기)
        invokeCallbackOnNoiseAndUnknown: true,
        overlapFactor: overlap,
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
