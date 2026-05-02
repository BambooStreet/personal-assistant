import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_TRAIN_PARAMS,
  NOISE_LABEL,
  POSITIVE_LABEL,
  UNKNOWN_LABEL,
  WakeWordDetector,
  getDetector,
  type DetectionResult,
  type ExampleCounts,
  type LoadStage,
} from "../../lib/voice/wakeword";

const LOAD_STAGE_LABEL: Record<LoadStage, string> = {
  module: "TF.js 모듈 번들링 중... (첫 실행에서만 오래 걸려요)",
  create: "speech-commands 인식기 생성 중...",
  weights: "베이스 모델 가중치 다운로드 중...",
  ready: "준비 완료",
};

const TARGET_POSITIVE = 8;
const TARGET_NOISE = 6;
const TARGET_UNKNOWN = 4;

type Phase =
  | "init"
  | "ready"
  | "collecting-positive"
  | "collecting-noise"
  | "collecting-unknown"
  | "training"
  | "trained"
  | "validating";

export function WakeWordTrainer() {
  const detectorRef = useRef<WakeWordDetector | null>(null);
  const [phase, setPhase] = useState<Phase>("init");
  const [counts, setCounts] = useState<ExampleCounts>({});
  const [wakePhrase, setWakePhrase] = useState("");
  const [recordingProgress, setRecordingProgress] = useState<{
    label: string;
    i: number;
    total: number;
  } | null>(null);
  const [trainProgress, setTrainProgress] = useState<{
    epoch: number;
    total: number;
    acc?: number;
    valAcc?: number;
  } | null>(null);
  const [validation, setValidation] = useState<DetectionResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadStage, setLoadStage] = useState<LoadStage | null>(null);

  // 마운트 시 detector 초기화 + 저장된 모델 로드 시도.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = getDetector();
        await d.init((stage) => {
          if (!cancelled) setLoadStage(stage);
        });
        const loaded = await d.load().catch(() => false);
        if (cancelled) return;
        detectorRef.current = d;
        setCounts(d.exampleCounts());
        setPhase(loaded && d.isTrained() ? "trained" : "ready");
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      const d = detectorRef.current;
      if (d?.isListening()) void d.stopListen();
    };
  }, []);

  const collect = async (
    label: string,
    target: number,
    nextPhase: Phase,
    setupPhase: Phase,
  ) => {
    const d = detectorRef.current;
    if (!d) return;
    setErr(null);
    setPhase(setupPhase);
    try {
      const existing = d.exampleCounts()[label] ?? 0;
      const remaining = Math.max(0, target - existing);
      for (let i = 0; i < remaining; i++) {
        setRecordingProgress({ label, i, total: remaining });
        await d.collectExample(label);
      }
      setRecordingProgress(null);
      setCounts(d.exampleCounts());
      setPhase(nextPhase);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRecordingProgress(null);
      setPhase("ready");
    }
  };

  const onTrain = async () => {
    const d = detectorRef.current;
    if (!d) return;
    setErr(null);
    setPhase("training");
    setTrainProgress({ epoch: 0, total: DEFAULT_TRAIN_PARAMS.epochs });
    try {
      await d.train({}, (epoch, logs) => {
        setTrainProgress({
          epoch: epoch + 1,
          total: DEFAULT_TRAIN_PARAMS.epochs,
          acc: logs.acc,
          valAcc: logs.valAcc,
        });
      });
      await d.save();
      setPhase("trained");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("ready");
    }
  };

  const onClear = async () => {
    const d = detectorRef.current;
    if (!d) return;
    if (d.isListening()) await d.stopListen();
    await d.clearExamples();
    setCounts(d.exampleCounts());
    setValidation(null);
    setPhase("ready");
  };

  const startValidate = async () => {
    const d = detectorRef.current;
    if (!d) return;
    setErr(null);
    setPhase("validating");
    try {
      await d.listen(
        () => {
          /* 검증 모드에선 wake 자체 동작 없음 — 점수만 onScore로 표시 */
        },
        { threshold: 1.01, suppressionMs: 0 },
        (result) => setValidation(result),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("trained");
    }
  };

  const stopValidate = async () => {
    const d = detectorRef.current;
    if (!d) return;
    await d.stopListen();
    setPhase("trained");
    setValidation(null);
  };

  const positiveCount = counts[POSITIVE_LABEL] ?? 0;
  const noiseCount = counts[NOISE_LABEL] ?? 0;
  const unknownCount = counts[UNKNOWN_LABEL] ?? 0;
  const canTrain =
    positiveCount >= TARGET_POSITIVE && noiseCount >= TARGET_NOISE;

  return (
    <section className="rounded-md border border-white/5 bg-bg-elevated/60 p-2.5">
      <header className="mb-2">
        <h4 className="text-xs font-medium">호칭 학습 (wake word)</h4>
        <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
          내 호칭을 인식하도록 모델을 학습합니다. 학습된 head는
          IndexedDB에만 저장되고 외부로 전송되지 않습니다.
        </p>
      </header>

      {phase === "init" && (
        <div className="text-[11px] text-fg-subtle">
          <p>{loadStage ? LOAD_STAGE_LABEL[loadStage] : "초기화 중..."}</p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg/60">
            <div
              className="h-full bg-accent/60 transition-all"
              style={{
                width:
                  loadStage === "module"
                    ? "20%"
                    : loadStage === "create"
                      ? "45%"
                      : loadStage === "weights"
                        ? "75%"
                        : loadStage === "ready"
                          ? "100%"
                          : "5%",
              }}
            />
          </div>
        </div>
      )}

      {phase !== "init" && (
        <>
          <div className="mb-2">
            <label className="mb-1 block text-[11px] text-fg-muted">
              호칭 (UI 표시용 — 모델 라벨은 내부적으로 'wake')
            </label>
            <input
              type="text"
              value={wakePhrase}
              onChange={(e) => setWakePhrase(e.target.value)}
              placeholder="예: 지오야"
              className="no-drag w-full rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs outline-none focus:border-accent/60"
            />
          </div>

          <div className="mb-2 grid grid-cols-3 gap-1.5 text-[10px]">
            <CountBlock
              label="호칭"
              count={positiveCount}
              target={TARGET_POSITIVE}
              accent="positive"
            />
            <CountBlock
              label="배경음"
              count={noiseCount}
              target={TARGET_NOISE}
              accent="noise"
            />
            <CountBlock
              label="비슷한 말"
              count={unknownCount}
              target={TARGET_UNKNOWN}
              accent="unknown"
            />
          </div>

          {recordingProgress && (
            <div className="mb-2 rounded-md bg-bg/60 p-2 text-[11px]">
              <p className="font-medium">
                녹음 중: {labelKor(recordingProgress.label)} (
                {recordingProgress.i + 1}/{recordingProgress.total})
              </p>
              <p className="mt-0.5 text-[10px] text-fg-subtle">
                마이크에 대고 1초간 발화 후 잠시 대기 — 자동으로 다음 샘플로
                넘어갑니다.
              </p>
            </div>
          )}

          {trainProgress && (
            <div className="mb-2 rounded-md bg-bg/60 p-2 text-[11px]">
              <p className="font-medium">
                학습 중 — epoch {trainProgress.epoch}/{trainProgress.total}
              </p>
              <p className="mt-0.5 text-[10px] text-fg-subtle">
                {trainProgress.acc !== undefined &&
                  `acc=${trainProgress.acc.toFixed(3)} `}
                {trainProgress.valAcc !== undefined &&
                  `val=${trainProgress.valAcc.toFixed(3)}`}
              </p>
            </div>
          )}

          {validation && (
            <div className="mb-2 rounded-md bg-bg/60 p-2 text-[11px]">
              <p className="mb-1 font-medium">실시간 점수</p>
              <ScoreBars scores={validation.scores} />
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <ActionBtn
              disabled={
                phase !== "ready" &&
                phase !== "collecting-positive" &&
                phase !== "trained"
              }
              busy={phase === "collecting-positive"}
              onClick={() =>
                collect(
                  POSITIVE_LABEL,
                  TARGET_POSITIVE,
                  "ready",
                  "collecting-positive",
                )
              }
            >
              호칭 녹음
            </ActionBtn>
            <ActionBtn
              disabled={
                phase !== "ready" &&
                phase !== "collecting-noise" &&
                phase !== "trained"
              }
              busy={phase === "collecting-noise"}
              onClick={() =>
                collect(NOISE_LABEL, TARGET_NOISE, "ready", "collecting-noise")
              }
            >
              배경음 녹음
            </ActionBtn>
            <ActionBtn
              disabled={
                phase !== "ready" &&
                phase !== "collecting-unknown" &&
                phase !== "trained"
              }
              busy={phase === "collecting-unknown"}
              onClick={() =>
                collect(
                  UNKNOWN_LABEL,
                  TARGET_UNKNOWN,
                  "ready",
                  "collecting-unknown",
                )
              }
            >
              비슷한 말 녹음 (선택)
            </ActionBtn>
            <ActionBtn
              variant="primary"
              disabled={!canTrain || phase === "training"}
              busy={phase === "training"}
              onClick={onTrain}
            >
              학습
            </ActionBtn>
            {phase === "trained" && (
              <ActionBtn variant="ghost" onClick={startValidate}>
                검증 시작
              </ActionBtn>
            )}
            {phase === "validating" && (
              <ActionBtn variant="ghost" onClick={stopValidate}>
                검증 중지
              </ActionBtn>
            )}
            <ActionBtn
              variant="ghost"
              disabled={phase === "training" || phase === "validating"}
              onClick={onClear}
            >
              샘플 초기화
            </ActionBtn>
          </div>

          {err && (
            <p className="mt-2 text-[11px] text-red-300">{err}</p>
          )}
          {phase === "trained" && !err && (
            <p className="mt-2 text-[11px] text-emerald-300">
              학습 완료 · IndexedDB에 저장됨
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CountBlock({
  label,
  count,
  target,
  accent,
}: {
  label: string;
  count: number;
  target: number;
  accent: "positive" | "noise" | "unknown";
}) {
  const ratio = Math.min(1, count / target);
  const colorBg =
    accent === "positive"
      ? "bg-emerald-500/40"
      : accent === "noise"
        ? "bg-sky-500/40"
        : "bg-amber-500/40";
  return (
    <div className="rounded-md border border-white/5 bg-bg/40 p-1.5">
      <div className="flex items-center justify-between">
        <span className="text-fg-muted">{label}</span>
        <span className="text-fg">
          {count}/{target}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg/60">
        <div
          className={`h-full ${colorBg}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function ScoreBars({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores);
  return (
    <div className="space-y-1">
      {entries.map(([label, score]) => (
        <div key={label}>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">{labelKor(label)}</span>
            <span className="text-fg">{score.toFixed(2)}</span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-bg/60">
            <div
              className={`h-full ${barColor(label)}`}
              style={{ width: `${Math.min(1, score) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  busy,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "default" | "primary" | "ghost";
}) {
  const cls =
    variant === "primary"
      ? "bg-accent/80 text-bg"
      : variant === "ghost"
        ? "border border-white/10 text-fg-muted hover:bg-bg-elevated"
        : "bg-bg-elevated/80 text-fg hover:bg-bg-elevated";
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className={`no-drag rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {busy ? "..." : children}
    </button>
  );
}

function labelKor(label: string): string {
  if (label === POSITIVE_LABEL) return "호칭";
  if (label === NOISE_LABEL) return "배경음";
  if (label === UNKNOWN_LABEL) return "비슷한 말";
  return label;
}

function barColor(label: string): string {
  if (label === POSITIVE_LABEL) return "bg-emerald-500/60";
  if (label === NOISE_LABEL) return "bg-sky-500/60";
  if (label === UNKNOWN_LABEL) return "bg-amber-500/60";
  return "bg-fg-subtle/40";
}
