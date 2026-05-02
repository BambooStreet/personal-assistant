import { useEffect, useState } from "react";

import { api, type CostSummary } from "../../lib/runtime";

export function CostPanel() {
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [cap, setCap] = useState<number>(1);
  const [capInput, setCapInput] = useState<string>("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [c, k] = await Promise.all([api.costSummary(), api.dailyCapGet()]);
      setCost(c);
      setCap(k);
      setCapInput(String(k));
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onSaveCap = async () => {
    const v = Number(capInput);
    if (!Number.isFinite(v) || v < 0) {
      setErr("한도는 0 이상의 숫자여야 합니다");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.dailyCapSet(v);
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">비용</h3>
        <span className="text-[11px] text-fg-subtle">
          호출 {cost?.total_calls ?? 0}회
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="오늘" value={cost?.today_usd} cap={cap} highlight />
        <Stat label="7일" value={cost?.last_7_days_usd} />
        <Stat label="이번 달" value={cost?.month_usd} />
      </div>

      <div className="rounded-md border border-white/5 bg-bg-elevated/50 p-2.5">
        <label className="text-[11px] text-fg-muted">일일 한도 (USD)</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            className="no-drag w-24 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs outline-none focus:border-accent/60"
          />
          <button
            type="button"
            onClick={onSaveCap}
            disabled={busy || capInput === String(cap)}
            className="no-drag rounded-md bg-accent/80 px-2 py-1 text-[11px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            저장
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
          오늘 누적 비용이 한도에 도달하면 채팅이 차단됩니다.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
          {err}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  cap,
  highlight,
}: {
  label: string;
  value: number | undefined;
  cap?: number;
  highlight?: boolean;
}) {
  const v = value ?? 0;
  const overCap = highlight && cap !== undefined && v >= cap;
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        overCap
          ? "border-red-500/40 bg-red-500/10"
          : "border-white/10 bg-bg/40"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p
        className={`mt-0.5 font-mono text-sm ${
          overCap ? "text-red-200" : "text-fg"
        }`}
      >
        ${v.toFixed(4)}
      </p>
    </div>
  );
}
