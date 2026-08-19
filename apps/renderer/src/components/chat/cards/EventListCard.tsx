import { CalendarDays, MapPin } from "lucide-react";

import type { ChatCardEvent } from "../../../lib/chatCards";

import {
  CardShell,
  MAX_CARD_ROWS,
  MoreRow,
  formatDateHeader,
  formatTimeRange,
  localDayKey,
} from "./shared";

interface Props {
  scope: "today" | "upcoming";
  events: ChatCardEvent[];
}

export function EventListCard({ scope, events }: Props) {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.start_at) - Date.parse(b.start_at),
  );
  const shown = sorted.slice(0, MAX_CARD_ROWS);
  const hidden = sorted.length - shown.length;
  // 오늘 일정은 전부 같은 날이라 날짜 헤더가 불필요. 다가오는 일정만 날짜별로 묶는다.
  const grouped = scope === "upcoming";

  return (
    <CardShell
      icon={<CalendarDays size={13} />}
      title={scope === "today" ? "오늘 일정" : "다가오는 일정"}
      count={events.length}
    >
      <ul className="flex flex-col">
        {shown.map((e, i) => {
          const newDay = grouped && (i === 0 || localDayKey(e.start_at) !== localDayKey(shown[i - 1].start_at));
          return (
            <li key={`${e.start_at}-${e.summary}-${i}`}>
              {newDay && (
                <p className="px-0.5 pt-1.5 pb-0.5 text-xs text-fg-subtle">
                  {formatDateHeader(e.start_at)}
                </p>
              )}
              <EventRow event={e} />
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <MoreRow count={hidden} />}
    </CardShell>
  );
}

function EventRow({ event }: { event: ChatCardEvent }) {
  const range = event.all_day ? null : formatTimeRange(event.start_at, event.end_at);
  const location = event.location?.trim();

  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="shrink-0 rounded bg-bg/60 px-1.5 py-0.5 text-xs tabular-nums text-fg-muted">
        {event.all_day ? "종일" : (range ?? "—")}
      </span>
      <span className="min-w-0 flex-1 text-xs">
        <span className="break-words text-fg">{event.summary}</span>
        {location && (
          <span className="ml-1 inline-flex items-baseline gap-0.5 text-fg-subtle">
            <MapPin size={11} className="translate-y-px" aria-hidden />
            {location}
          </span>
        )}
      </span>
    </div>
  );
}
