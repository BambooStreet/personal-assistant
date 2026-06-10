import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/cn";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 값은 datetime-local과 동일한 로컬 문자열 "YYYY-MM-DDTHH:mm" ("" = 미선택).
// 위젯이 작은 frameless 창이라 네이티브 datetime-local 팝업이 잘리는 문제를 피하려고
// 창 내부 DOM에 직접 렌더하는 달력 팝오버로 대체.
export function DateField({
  value,
  onChange,
  placeholder = "날짜 선택",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value) : null;
  const [view, setView] = useState<Date>(selected ?? new Date());
  // 시간은 자체 로컬 상태로 관리 — 부모 value에서 매 렌더 재계산하면 타이핑 중간(빈 값)에
  // 스냅백돼 입력이 튕긴다. 로컬 상태는 입력값을 그대로 반영하고, 완성된 값만 부모로 전달.
  const [time, setTime] = useState<string>(value ? value.slice(11, 16) : "09:00");

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(view)),
    end: endOfWeek(endOfMonth(view)),
  });

  const pick = (d: Date) => {
    onChange(`${format(d, "yyyy-MM-dd")}T${time || "09:00"}`);
    setOpen(false);
  };
  const onTimeChange = (t: string) => {
    setTime(t); // 로컬은 항상 입력 그대로 — 비어도 되돌리지 않음.
    if (!t) return; // 미완성 값은 부모로 전달하지 않음(스냅백 방지).
    const base = selected ?? new Date();
    onChange(`${format(base, "yyyy-MM-dd")}T${t}`);
  };
  const clear = () => {
    onChange("");
    setTime("09:00");
    setOpen(false);
  };

  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[11px] outline-none focus:border-accent/60",
          selected ? "text-fg" : "text-fg-subtle",
        )}
      >
        <CalendarDays size={12} className="shrink-0 text-fg-muted" />
        {selected ? format(selected, "yyyy.MM.dd HH:mm") : placeholder}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/10 bg-bg-elevated p-2 shadow-xl">
          {/* 월 헤더 */}
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView((m) => addMonths(m, -1))}
              className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:text-fg"
              aria-label="이전 달"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[11px] font-medium text-fg">
              {format(view, "yyyy년 M월")}
            </span>
            <button
              type="button"
              onClick={() => setView((m) => addMonths(m, 1))}
              className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:text-fg"
              aria-label="다음 달"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* 요일 */}
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="flex h-5 items-center justify-center text-[9px] text-fg-subtle"
              >
                {w}
              </div>
            ))}
            {days.map((d) => {
              const isSel = selected && isSameDay(d, selected);
              const inMonth = isSameMonth(d, view);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => pick(d)}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded text-[10px]",
                    !inMonth && "text-fg-subtle/40",
                    inMonth && "text-fg-muted hover:bg-white/10",
                    isToday(d) && !isSel && "text-accent",
                    isSel && "bg-accent text-bg",
                  )}
                >
                  {format(d, "d")}
                </button>
              );
            })}
          </div>

          {/* 시간 + 지우기 */}
          <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-2">
            <input
              type="time"
              value={time}
              onChange={(e) => onTimeChange(e.target.value)}
              className="flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[11px] text-fg outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={clear}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-fg-subtle hover:text-red-300"
            >
              <X size={11} /> 지우기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
