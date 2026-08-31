import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { StoredEventLite } from "../../lib/api";
import { useCalendarStore } from "../../stores/useCalendarStore";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/** 일정 색은 id로 돌린다 — 캘린더에 색 정보가 없고, 같은 일정이 늘 같은 색이면 충분하다. */
const DOT_COLORS = ["bg-teal", "bg-sage", "bg-rose", "bg-gold"];
const BAR_COLORS = ["bg-teal", "bg-sage", "bg-rose", "bg-gold"];

/** 로컬 날짜 키 `YYYY-MM-DD`. toISOString은 UTC로 바꿔버려 KST 자정 근처에서 하루가 밀린다. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 일정의 시작 날짜 키. 종일 일정은 `start_at`이 `"2026-10-24"`처럼 날짜만이라
 * `new Date()`에 그대로 넣으면 **UTC 자정**으로 읽혀 타임존에 따라 하루가 밀린다.
 * 날짜만 있으면 그 문자열을 그대로 키로 쓴다.
 */
function eventDateKey(e: StoredEventLite): string {
  if (!e.start_at.includes("T")) return e.start_at.slice(0, 10);
  return dateKey(new Date(e.start_at));
}

/**
 * 그리드가 덮는 기간을 UTC 경계로. **앞뒤로 하루씩 넓힌다** — 종일 일정은
 * start_at/end_at이 `"2026-10-24"`처럼 날짜만이라 타임스탬프와 문자열로 비교하면
 * 경계 날짜의 종일 일정이 조용히 빠진다. 넘치게 받아도 날짜별로 묶을 때 걸러진다.
 */
function gridRange(cells: { date: Date }[]): [string, string] {
  const from = new Date(cells[0].date);
  from.setDate(from.getDate() - 1);
  from.setHours(0, 0, 0, 0);
  const to = new Date(cells[cells.length - 1].date);
  to.setDate(to.getDate() + 1);
  to.setHours(23, 59, 59, 999);
  return [from.toISOString(), to.toISOString()];
}

export function CalendarPanel() {
  const monthEvents = useCalendarStore((s) => s.monthEvents);
  const error = useCalendarStore((s) => s.error);
  const loadRange = useCalendarStore((s) => s.loadRange);
  const createEvent = useCalendarStore((s) => s.createEvent);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);

  const today = useMemo(() => new Date(), []);
  const todayKey = dateKey(today);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based
  const [selected, setSelected] = useState(todayKey);

  // 그리드가 덮는 42칸(6주)의 앞뒤 달까지 포함한 실제 범위.
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const startDow = first.getDay();
    const out: { date: Date; key: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(year, month, 1 - startDow + i);
      out.push({ date: d, key: dateKey(d), inMonth: d.getMonth() === month });
    }
    return out;
  }, [year, month]);

  useEffect(() => {
    void loadRange(...gridRange(cells));
  }, [cells, loadRange]);

  useEffect(() => {
    const off = api.on("calendar.synced", () =>
      void loadRange(...gridRange(cells)),
    );
    return () => off();
  }, [cells, loadRange]);

  // 날짜별로 묶는다. 종일 일정도 start_at 기준으로 하루에만 놓는다(여러 날 걸침은 미지원).
  const byDate = useMemo(() => {
    const m = new Map<string, StoredEventLite[]>();
    for (const e of monthEvents) {
      const k = eventDateKey(e);
      const list = m.get(k);
      if (list) list.push(e);
      else m.set(k, [e]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    }
    return m;
  }, [monthEvents]);

  const selEvents = byDate.get(selected) ?? [];
  const selDate = new Date(`${selected}T00:00:00`);
  const selLabel =
    `${selDate.getMonth() + 1}월 ${selDate.getDate()}일 ${WEEKDAYS[selDate.getDay()]}요일` +
    (selected === todayKey ? " · 오늘" : "");

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelected(todayKey);
  };

  return (
    <div className="panel-scroll h-full pb-5 pl-4 pr-2 pt-3.5 text-xs">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-[19px] font-bold tracking-[-0.01em] text-fg">
          {year}. {String(month + 1).padStart(2, "0")}
        </p>
        <div className="flex items-center gap-2">
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-sage" />
            Google 연동됨
          </span>
          <NavButton label="이전 달" onClick={() => step(-1)}>
            <ChevronLeft size={11} />
          </NavButton>
          <button
            type="button"
            onClick={goToday}
            className="no-drag flex h-7 shrink-0 items-center whitespace-nowrap rounded border border-line px-2.5 text-xs text-fg-muted hover:border-gold hover:text-fg"
          >
            오늘
          </button>
          <NavButton label="다음 달" onClick={() => step(1)}>
            <ChevronRight size={11} />
          </NavButton>
        </div>
      </div>

      {/* 왼쪽에서 사라지는 골드 디바이더 — 채팅 날짜 구분선과 같은 결. */}
      <div className="my-3 h-px bg-[linear-gradient(90deg,rgb(var(--gold))_0%,rgb(var(--line))_45%,transparent_100%)]" />

      {/* 조회가 실패하면 반드시 말한다 — 안 그러면 "일정 없음"과 구분이 안 된다. */}
      {error && (
        <p className="mb-2 rounded border border-rose/40 bg-rose/10 px-2.5 py-2 text-xs text-rose">
          일정을 불러오지 못했어요. {error}
        </p>
      )}

      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={cn(
              "py-1 text-center text-[10px] tracking-[0.14em]",
              i === 0 ? "text-rose" : i === 6 ? "text-teal" : "text-fg-muted",
            )}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c) => {
          const isToday = c.key === todayKey;
          const isSel = c.key === selected;
          const dots = (byDate.get(c.key) ?? []).slice(0, 4);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelected(c.key)}
              className={cn(
                "no-drag min-h-[40px] rounded border p-1 text-left transition-colors hover:border-gold",
                isSel
                  ? "border-gold bg-halo"
                  : isToday
                    ? "border-gold-soft"
                    : "border-line",
                !c.inMonth && "opacity-35",
              )}
            >
              <span
                className={cn(
                  "block text-[11px] tabular-nums",
                  isToday ? "text-accent" : "text-fg",
                  isToday || isSel ? "font-bold" : "font-normal",
                )}
              >
                {c.date.getDate()}
              </span>
              <span className="mt-1 flex flex-wrap gap-[3px]">
                {dots.map((e) => (
                  <span
                    key={e.id}
                    className={cn(
                      "h-1 w-1 rounded-full",
                      DOT_COLORS[e.id % DOT_COLORS.length],
                    )}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <SelectedDay
        label={selLabel}
        dateKey={selected}
        events={selEvents}
        onCreate={createEvent}
        onDelete={deleteEvent}
      />
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line text-fg-muted hover:border-gold hover:text-fg"
    >
      {children}
    </button>
  );
}

function SelectedDay({
  label,
  dateKey: key,
  events,
  onCreate,
  onDelete,
}: {
  label: string;
  dateKey: string;
  events: StoredEventLite[];
  onCreate: (draft: {
    summary: string;
    start_at: string;
    end_at: string;
  }) => Promise<unknown>;
  onDelete: (googleEventId: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    setAdding(false);
    await onCreate({
      summary: t,
      start_at: new Date(`${key}T${start}:00`).toISOString(),
      end_at: new Date(`${key}T${end}:00`).toISOString(),
    });
  };

  return (
    <>
      <div className="mb-2.5 mt-5 flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold tracking-[0.04em] text-fg">
            {label}
          </span>
          <span className="shrink-0 whitespace-nowrap text-[11.5px] text-fg-muted">
            {events.length}건
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="no-drag shrink-0 whitespace-nowrap rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:brightness-110"
        >
          + 일정 추가
        </button>
      </div>

      {adding && (
        <div className="no-drag mb-3 rounded border border-gold-soft bg-bg-elevated p-3">
          <div className="grid grid-cols-[1fr_92px_92px_auto] items-center gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void save();
                }
              }}
              placeholder="일정 제목"
              className="h-8 min-w-0 rounded border border-line bg-bg-panel px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-gold"
            />
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-8 min-w-0 rounded border border-line bg-bg-panel px-2 text-xs text-fg outline-none focus:border-gold"
            />
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-8 min-w-0 rounded border border-line bg-bg-panel px-2 text-xs text-fg outline-none focus:border-gold"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={!title.trim()}
              className="h-8 whitespace-nowrap rounded bg-accent px-3.5 text-[12.5px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-40"
            >
              저장
            </button>
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <p className="rounded border border-dashed border-line py-6 text-center text-[12.5px] text-fg-muted">
          일정 없음
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => (
            <div
              key={e.id}
              className="group flex items-center gap-3 rounded border border-line bg-bg-panel px-3 py-2.5 hover:border-gold"
            >
              <div className="w-14 shrink-0 text-right">
                <div className="text-[12.5px] font-semibold tabular-nums text-fg">
                  {e.all_day ? "종일" : hhmm(e.start_at)}
                </div>
                {!e.all_day && (
                  <div className="text-[10.5px] tabular-nums text-fg-muted">
                    {hhmm(e.end_at)}
                  </div>
                )}
              </div>
              <span
                className={cn(
                  "w-[3px] shrink-0 self-stretch rounded-full",
                  BAR_COLORS[e.id % BAR_COLORS.length],
                )}
              />
              <div className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">
                {e.summary}
              </div>
              {/* Google이 원본이라 동기화된 일정만 지울 수 있다. */}
              {e.google_event_id && (
                <button
                  type="button"
                  onClick={() => void onDelete(e.google_event_id as string)}
                  className="no-drag invisible shrink-0 px-1.5 py-1 text-[11px] text-fg-muted hover:text-rose group-hover:visible"
                >
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
