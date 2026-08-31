import { useState } from "react";

import { cn } from "../../lib/cn";

// 요일 비트마스크: bit0=월 … bit6=일. Core(`services/goals/pure.rs`)와 같은 규약.
// ⚠️ 일정 탭의 월간 그리드는 0=일 기준이라 규약이 다르다 — 그쪽 코드를 복사해 오지 말 것.
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const DAILY_MASK = 0b111_1111;

function toggleDayBit(mask: number, day: number): number {
  return mask ^ (1 << day);
}

/** 목표에 딸린 루틴(요일 + 시각 한 점) 추가 폼. */
export function RoutineForm({
  onSave,
  onCancel,
}: {
  onSave: (timeHhmm: string, daysMask: number) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [time, setTime] = useState("22:00");
  const [mask, setMask] = useState(DAILY_MASK);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-bg/40 p-2">
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="no-drag rounded-md border border-line bg-bg/60 px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent/60"
        />
        <button
          type="button"
          onClick={() => setMask(DAILY_MASK)}
          className={cn(
            "rounded-md px-1.5 py-0.5 text-xs",
            mask === DAILY_MASK
              ? "bg-accent text-accent-fg"
              : "border border-line text-fg-muted hover:text-fg",
          )}
        >
          매일
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {DAY_LABELS.map((d, day) => (
          <button
            key={day}
            type="button"
            onClick={() => setMask((m) => toggleDayBit(m, day))}
            className={cn(
              "no-drag h-6 w-6 rounded-md text-xs transition-colors",
              mask & (1 << day)
                ? "bg-accent text-accent-fg"
                : "border border-line text-fg-muted hover:text-fg",
            )}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-fg-muted hover:text-fg"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void onSave(time, mask)}
          disabled={mask === 0 || !time}
          className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg disabled:opacity-40"
        >
          추가
        </button>
      </div>
    </div>
  );
}
