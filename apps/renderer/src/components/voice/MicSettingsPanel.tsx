import { Mic, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import { useUserSettingsStore } from "../../stores/useUserSettingsStore";
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
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">마이크</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="no-drag inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
          aria-label="목록 새로고침"
          title="다시 검색"
        >
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
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
    </div>
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
          : "border-white/5 bg-bg-elevated/40 hover:bg-bg-elevated/70",
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
