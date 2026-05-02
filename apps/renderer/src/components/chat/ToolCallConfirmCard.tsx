import { Check, X } from "lucide-react";
import { useState } from "react";
import { format, parseISO } from "date-fns";

import { api, type ToolCall } from "../../lib/runtime";
import { useChatStore } from "../../stores/useChatStore";
import { useTodoStore } from "../../stores/useTodoStore";

interface Props {
  call: ToolCall;
}

export function ToolCallConfirmCard({ call }: Props) {
  if (call.name === "create_todo") {
    return <CreateTodoCard call={call} />;
  }
  if (call.name === "create_event") {
    return <CreateEventCard call={call} />;
  }
  return <UnknownToolCard call={call} />;
}

function UnknownToolCard({ call }: Props) {
  const dismiss = useChatStore((s) => s.dismissPendingTool);
  return (
    <div className="rounded-md border border-amber-400/30 bg-amber-500/10 p-2 text-xs text-amber-200">
      <p>
        <span className="font-medium">{call.name}</span> 도구 호출은 아직
        지원하지 않습니다.
      </p>
      <button
        type="button"
        className="mt-1 text-[11px] text-fg-subtle hover:text-fg"
        onClick={dismiss}
      >
        닫기
      </button>
    </div>
  );
}

function CreateTodoCard({ call }: Props) {
  const dismiss = useChatStore((s) => s.dismissPendingTool);
  const create = useTodoStore((s) => s.create);
  const refresh = useTodoStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const args = call.arguments as {
    title?: string;
    notes?: string;
    due_at?: string;
    priority?: number;
  };

  const onConfirm = async () => {
    if (!args.title) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await create({
        title: args.title,
        notes: args.notes ?? null,
        due_at: args.due_at ?? null,
        priority: args.priority ?? null,
      });
      if (!created) throw new Error("생성 실패");
      await refresh(true);
      dismiss();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmShell
      label="할 일 추가 제안"
      err={err}
      busy={busy}
      disabled={!args.title}
      onConfirm={onConfirm}
      onDismiss={dismiss}
    >
      <p className="text-sm font-medium">{args.title ?? "(제목 없음)"}</p>
      {args.due_at && (
        <p className="text-[11px] text-fg-muted">
          마감: <span className="font-mono">{prettyDate(args.due_at)}</span>
        </p>
      )}
      {args.notes && <p className="text-[11px] text-fg-muted">{args.notes}</p>}
      {typeof args.priority === "number" && args.priority > 0 && (
        <p className="text-[11px] text-fg-muted">우선순위 {args.priority}</p>
      )}
    </ConfirmShell>
  );
}

function CreateEventCard({ call }: Props) {
  const dismiss = useChatStore((s) => s.dismissPendingTool);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const args = call.arguments as {
    summary?: string;
    start_at?: string;
    end_at?: string;
    description?: string;
    location?: string;
    all_day?: boolean;
  };

  const validates = Boolean(args.summary && args.start_at && args.end_at);

  const onConfirm = async () => {
    if (!validates) return;
    setBusy(true);
    setErr(null);
    try {
      await api.calendarCreateEvent({
        summary: args.summary!,
        description: args.description ?? null,
        location: args.location ?? null,
        start_at: args.start_at!,
        end_at: args.end_at!,
        all_day: args.all_day ?? false,
      });
      dismiss();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmShell
      label="캘린더 이벤트 추가 제안"
      err={err}
      busy={busy}
      disabled={!validates}
      onConfirm={onConfirm}
      onDismiss={dismiss}
    >
      <p className="text-sm font-medium">{args.summary ?? "(제목 없음)"}</p>
      {args.start_at && args.end_at && (
        <p className="text-[11px] text-fg-muted">
          {prettyRange(args.start_at, args.end_at, args.all_day ?? false)}
        </p>
      )}
      {args.location && (
        <p className="text-[11px] text-fg-muted">📍 {args.location}</p>
      )}
      {args.description && (
        <p className="line-clamp-3 text-[11px] text-fg-subtle">
          {args.description}
        </p>
      )}
    </ConfirmShell>
  );
}

interface ConfirmShellProps {
  label: string;
  err: string | null;
  busy: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  children: React.ReactNode;
}

function ConfirmShell({
  label,
  err,
  busy,
  disabled,
  onConfirm,
  onDismiss,
  children,
}: ConfirmShellProps) {
  return (
    <div className="rounded-md border border-accent/30 bg-accent/10 p-2.5 text-xs text-fg">
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-accent">
        {label}
      </div>
      <div className="space-y-1">{children}</div>
      {err && <p className="mt-1.5 text-[11px] text-red-300">{err}</p>}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onConfirm}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent/85 px-2 py-1 text-bg transition-opacity disabled:opacity-40"
        >
          <Check size={12} />
          <span className="text-[11px] font-medium">{busy ? "..." : "추가"}</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="flex items-center justify-center gap-1 rounded-md border border-white/10 px-2 py-1 text-fg-muted hover:bg-bg-elevated"
        >
          <X size={12} />
          <span className="text-[11px]">무시</span>
        </button>
      </div>
    </div>
  );
}

function prettyDate(iso: string): string {
  try {
    return format(parseISO(iso), "MM/dd HH:mm");
  } catch {
    return iso;
  }
}

function prettyRange(start: string, end: string, allDay: boolean): string {
  try {
    const s = parseISO(start);
    const e = parseISO(end);
    if (allDay) {
      const sameDay = format(s, "yyyy-MM-dd") === format(e, "yyyy-MM-dd");
      return sameDay
        ? `${format(s, "yyyy/MM/dd")} (종일)`
        : `${format(s, "yyyy/MM/dd")} – ${format(e, "yyyy/MM/dd")} (종일)`;
    }
    const sameDay = format(s, "yyyy-MM-dd") === format(e, "yyyy-MM-dd");
    if (sameDay) {
      return `${format(s, "yyyy/MM/dd HH:mm")} – ${format(e, "HH:mm")}`;
    }
    return `${format(s, "yyyy/MM/dd HH:mm")} – ${format(e, "yyyy/MM/dd HH:mm")}`;
  } catch {
    return `${start} – ${end}`;
  }
}
