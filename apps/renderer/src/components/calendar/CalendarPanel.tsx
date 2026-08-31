import { CalendarPlus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useEffect, useState } from "react";

import { api } from "../../lib/api";
import type { StoredEventLite } from "../../lib/api";
import { useCalendarStore } from "../../stores/useCalendarStore";
import { SectionHeader } from "../common/SectionHeader";

// 일정 탭. 원래 TodoPanel 안의 "오늘 일정" 섹션이었고, 탭으로 독립하면서 자기 데이터 로딩을
// 직접 한다. 월간 캘린더 그리드는 디자인에 있지만 아직 없다 — 지금은 오늘 일정만 보여준다.
export function CalendarPanel() {
  const events = useCalendarStore((s) => s.events);
  const refreshToday = useCalendarStore((s) => s.refreshToday);
  const createEvent = useCalendarStore((s) => s.createEvent);

  const [adding, setAdding] = useState(false);
  const [summary, setSummary] = useState("");
  const [start, setStart] = useState("");

  useEffect(() => {
    void refreshToday();
    // 백그라운드 동기화가 끝나면 목록을 다시 읽는다.
    const off = api.on("calendar.synced", () => void refreshToday());
    return () => off();
  }, [refreshToday]);

  const onAdd = async () => {
    const s = summary.trim();
    if (!s || !start) return;
    const startIso = localToIso(start);
    const endIso = new Date(
      new Date(start).getTime() + 60 * 60 * 1000,
    ).toISOString(); // 기본 1시간
    setSummary("");
    setStart("");
    setAdding(false);
    await createEvent({ summary: s, start_at: startIso, end_at: endIso });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-2 text-xs">
      <SectionHeader
        label="오늘 일정"
        action={
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="no-drag flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-fg-muted hover:text-accent"
            aria-label="일정 추가"
          >
            <CalendarPlus size={12} /> 추가
          </button>
        }
      />

      {adding && (
        <div className="no-drag mb-2 flex flex-col gap-2 rounded-md border border-line bg-bg-elevated/50 p-2">
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="일정 제목"
            className="rounded-md border border-line bg-bg/60 px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-accent/60"
          />
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="flex-1 rounded-md border border-line bg-bg/60 px-2 py-1 text-xs text-fg outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={!summary.trim() || !start}
              className="rounded-md bg-accent/85 px-2 py-1 text-xs font-semibold text-accent-fg disabled:opacity-40"
            >
              추가
            </button>
          </div>
        </div>
      )}

      {events.length === 0 && !adding ? (
        <p className="px-2 py-6 text-center text-xs text-fg-muted">
          오늘 일정이 없어요.
        </p>
      ) : (
        <ul className="space-y-1">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-md border border-line bg-bg-elevated/30 p-2"
            >
              <span className="w-12 shrink-0 text-[11px] tabular-nums text-accent">
                {eventTime(e)}
              </span>
              <span className="flex-1 truncate text-xs text-fg">
                {e.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function eventTime(e: StoredEventLite): string {
  if (e.all_day) return "종일";
  try {
    return format(parseISO(e.start_at), "HH:mm");
  } catch {
    return "";
  }
}

/** `datetime-local` 값(로컬 시각, 타임존 없음)을 UTC RFC3339로. */
function localToIso(local: string): string {
  return new Date(local).toISOString();
}
