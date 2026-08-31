import { Mic, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import {
  useUserSettingsStore,
  VAD_DEFAULTS,
  WAKE_THRESHOLD_DEFAULT,
} from "../../stores/useUserSettingsStore";
import { MicTester } from "./MicTester";

interface MicDevice {
  deviceId: string;
  label: string;
}

export function MicSettingsPanel() {
  const micDeviceId = useUserSettingsStore((s) => s.micDeviceId);
  const setMicDeviceId = useUserSettingsStore((s) => s.setMicDeviceId);
  const loaded = useUserSettingsStore((s) => s.loaded);
  const load = useUserSettingsStore((s) => s.load);

  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [needPermission, setNeedPermission] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const refresh = async () => {
    setBusy(true);
    setErr(null);
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || "(이름 미상 - 마이크 권한 허용 필요)",
        }));
      setDevices(inputs);
      const anyUnnamed = inputs.some((d) => !d.label.startsWith("(이름 미상"));
      setNeedPermission(!anyUnnamed && inputs.length > 0);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const grantPermission = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch (e) {
      setErr(`권한 거부 또는 마이크 없음: ${e}`);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <>
      <div className="flex items-center justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="no-drag inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
          aria-label="목록 새로고침"
          title="다시 검색"
        >
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>

      {needPermission && (
        <div className="rounded-md border border-amber-400/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
          <p className="mb-1.5">
            마이크 이름을 보려면 권한이 필요합니다. 한 번만 허용하면 됩니다.
          </p>
          <button
            type="button"
            onClick={() => void grantPermission()}
            className="no-drag inline-flex items-center gap-1 rounded-md bg-amber-500/30 px-2 py-1 font-medium hover:bg-amber-500/40"
          >
            <Mic size={11} />
            마이크 권한 허용
          </button>
        </div>
      )}

      <ul className="space-y-1">
        <li>
          <DeviceRow
            id={null}
            label="기본 (시스템)"
            hint="OS의 기본 마이크 사용"
            selected={micDeviceId === null}
            onSelect={() => void setMicDeviceId(null)}
          />
        </li>
        {devices.map((d) => (
          <li key={d.deviceId}>
            <DeviceRow
              id={d.deviceId}
              label={d.label}
              selected={micDeviceId === d.deviceId}
              onSelect={() => void setMicDeviceId(d.deviceId)}
            />
          </li>
        ))}
        {devices.length === 0 && !busy && (
          <li className="px-2 py-3 text-center text-[11px] text-fg-subtle">
            연결된 마이크가 없습니다.
          </li>
        )}
      </ul>

      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
          {err}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-fg-subtle">
        선택은 즉시 저장되며, 다음 녹음부터 적용됩니다.
      </p>

      <MicTester deviceId={micDeviceId} />

      <VadTuningSection />
    </>
  );
}

function VadTuningSection() {
  const thresholdRms = useUserSettingsStore((s) => s.micThresholdRms);
  const silenceMs = useUserSettingsStore((s) => s.micSilenceMs);
  const initialWaitMs = useUserSettingsStore((s) => s.micInitialWaitMs);
  const followupInitialWaitMs = useUserSettingsStore(
    (s) => s.micFollowupInitialWaitMs,
  );
  const followupEnabled = useUserSettingsStore((s) => s.voiceFollowupEnabled);
  const setThreshold = useUserSettingsStore((s) => s.setMicThresholdRms);
  const setSilence = useUserSettingsStore((s) => s.setMicSilenceMs);
  const setInitialWait = useUserSettingsStore((s) => s.setMicInitialWaitMs);
  const setFollowupInitial = useUserSettingsStore(
    (s) => s.setMicFollowupInitialWaitMs,
  );
  const setFollowupEnabled = useUserSettingsStore(
    (s) => s.setVoiceFollowupEnabled,
  );
  const reset = useUserSettingsStore((s) => s.resetMicVadToDefaults);

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">음성 인식 튜닝</h4>
        <button
          type="button"
          onClick={() => void reset()}
          className="no-drag inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-bg-elevated hover:text-fg"
          title="기본값 복원"
        >
          <RotateCcw size={10} />
          기본값
        </button>
      </div>

      <Slider
        label="감지 임계값"
        hint="높일수록 잡음에 둔감 (false trigger 감소)"
        value={thresholdRms}
        min={0.01}
        max={0.1}
        step={0.005}
        format={(v) => v.toFixed(3)}
        onChange={(v) => void setThreshold(v)}
      />
      <Slider
        label="발화 종료 침묵 (ms)"
        hint="이 시간만큼 조용하면 자동 종료"
        value={silenceMs}
        min={500}
        max={3000}
        step={100}
        format={(v) => `${Math.round(v)} ms`}
        onChange={(v) => void setSilence(v)}
      />
      <Slider
        label="첫 발화 대기 (ms)"
        hint="wake 후 이 시간 안에 말 안 하면 종료"
        value={initialWaitMs}
        min={3000}
        max={15000}
        step={500}
        format={(v) => `${(v / 1000).toFixed(1)} s`}
        onChange={(v) => void setInitialWait(v)}
      />
      <Slider
        label="후속 대화 대기 (ms)"
        hint="응답 직후 후속 발화를 기다리는 시간"
        value={followupInitialWaitMs}
        min={2000}
        max={10000}
        step={500}
        format={(v) => `${(v / 1000).toFixed(1)} s`}
        onChange={(v) => void setFollowupInitial(v)}
      />

      <label className="flex items-center justify-between rounded-md border border-line bg-bg-elevated/40 px-2 py-1.5 text-[11px]">
        <span className="flex flex-col">
          <span className="font-medium text-fg">응답 후 자동 재청취</span>
          <span className="text-[10px] text-fg-subtle">
            후속 질문을 wake 없이 이어서 받기
          </span>
        </span>
        <input
          type="checkbox"
          checked={followupEnabled}
          onChange={(e) => void setFollowupEnabled(e.target.checked)}
          className="no-drag h-3.5 w-3.5"
        />
      </label>

      <WakeThresholdSlider />

      <p className="text-[10px] leading-relaxed text-fg-subtle">
        기본값: 임계값 {VAD_DEFAULTS.thresholdRms}, 침묵{" "}
        {VAD_DEFAULTS.silenceMs}ms, 첫 발화 {VAD_DEFAULTS.initialWaitMs / 1000}
        s, 후속 {VAD_DEFAULTS.followupInitialWaitMs / 1000}s, wake{" "}
        {WAKE_THRESHOLD_DEFAULT.toFixed(2)}.
      </p>
    </div>
  );
}

function WakeThresholdSlider() {
  const value = useUserSettingsStore((s) => s.wakeThreshold);
  const setValue = useUserSettingsStore((s) => s.setWakeThreshold);
  const label = useUserSettingsStore((s) => s.wakeDisplayLabel);
  const setLabel = useUserSettingsStore((s) => s.setWakeDisplayLabel);
  return (
    <div className="space-y-2">
      <Slider
        label="Wake word 민감도"
        hint="높일수록 호칭 외 말소리에 덜 반응 (false trigger 감소)"
        value={value}
        min={0.7}
        max={0.99}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => void setValue(v)}
      />
      <label className="flex flex-col gap-1 text-[11px]">
        <span className="font-medium text-fg">호명 라벨</span>
        <input
          type="text"
          value={label}
          onChange={(e) => void setLabel(e.target.value)}
          placeholder={`예: 보조야 (비우면 "(부름)")`}
          maxLength={40}
          className="no-drag rounded-md border border-line bg-bg-elevated/40 px-2 py-1 text-fg outline-none focus:border-accent/40"
        />
        <span className="text-[10px] text-fg-subtle">
          채팅 로그에 wake 호출이 어떻게 표시될지 (학습한 단어 입력).
        </span>
      </label>
    </div>
  );
}

interface SliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: SliderProps) {
  return (
    <label className="flex flex-col gap-1 text-[11px]">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-fg">{label}</span>
        <span className="font-mono text-[10px] text-fg-muted">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="no-drag h-1 w-full cursor-pointer accent-accent"
      />
      {hint && <span className="text-[10px] text-fg-subtle">{hint}</span>}
    </label>
  );
}

interface DeviceRowProps {
  id: string | null;
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}

function DeviceRow({ label, hint, selected, onSelect }: DeviceRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "no-drag flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
        selected
          ? "border-accent/40 bg-accent/10"
          : "border-line bg-bg-elevated/40 hover:bg-bg-elevated/70",
      )}
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          selected ? "bg-accent" : "bg-fg-subtle/50",
        )}
      />
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[12px]">{label}</span>
        {hint && (
          <span className="block truncate text-[10px] text-fg-subtle">
            {hint}
          </span>
        )}
      </span>
      {selected && <span className="text-[10px] text-accent">선택</span>}
    </button>
  );
}
