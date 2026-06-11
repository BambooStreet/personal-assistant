import { Check, X } from "lucide-react";
import { useState } from "react";
import { format, parseISO } from "date-fns";

import { api, type ToolCall } from "../../lib/api";
import { buildEventPatch } from "../../lib/chat/toolExecutors";
import { useChatStore } from "../../stores/useChatStore";
import { useTodoStore } from "../../stores/useTodoStore";

interface Props {
  call: ToolCall;
}

export function ToolCallConfirmCard({ call }: Props) {
  switch (call.name) {
    case "create_todo":
      return <CreateTodoCard call={call} />;
    case "complete_todo":
      return <CompleteTodoCard call={call} />;
    case "delete_todo":
      return <DeleteTodoCard call={call} />;
    case "create_event":
      return <CreateEventCard call={call} />;
    case "update_event":
      return <UpdateEventCard call={call} />;
    case "delete_event":
      return <DeleteEventCard call={call} />;
    case "remember_fact":
      return <RememberFactCard call={call} />;
    default:
      return <UnknownToolCard call={call} />;
  }
}

function UnknownToolCard({ call }: Props) {
  const reject = useChatStore((s) => s.rejectTool);
  return (
    <div className="rounded-md border border-amber-400/30 bg-amber-500/10 p-2 text-xs text-amber-200">
      <p>
        <span className="font-medium">{call.name}</span> 도구 호출은 아직
        지원하지 않습니다.
      </p>
      <button
        type="button"
        className="mt-1 text-[11px] text-fg-subtle hover:text-fg"
        onClick={() => void reject(call)}
      >
        닫기
      </button>
    </div>
  );
}

function CreateTodoCard({ call }: Props) {
  const confirm = useChatStore((s) => s.confirmTool);
  const reject = useChatStore((s) => s.rejectTool);
  const refresh = useTodoStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const args = call.arguments as {
    title?: string;
    notes?: string;
    due_at?: string;
    priority?: number;
    estimated_minutes?: number;
  };

  const onConfirm = async () => {
    if (!args.title) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm(call, async () => {
        const created = await api.todosCreate({
          title: args.title!,
          notes: args.notes ?? null,
          due_at: args.due_at ?? null,
          priority: args.priority ?? null,
          estimated_minutes: args.estimated_minutes ?? null,
        });
        await refresh(true);
        return JSON.stringify(created);
      });
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
      onDismiss={() => void reject(call)}
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
      {typeof args.estimated_minutes === "number" && (
        <p className="text-[11px] text-fg-muted">예상 {args.estimated_minutes}분</p>
      )}
    </ConfirmShell>
  );
}

function CompleteTodoCard({ call }: Props) {
  const confirm = useChatStore((s) => s.confirmTool);
  const reject = useChatStore((s) => s.rejectTool);
  const refresh = useTodoStore((s) => s.refresh);
  const todos = useTodoStore((s) => s.todos);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const args = call.arguments as { id?: number };
  const id = typeof args.id === "number" ? args.id : null;
  const target = id != null ? todos.find((t) => t.id === id) : null;

  const onConfirm = async () => {
    if (id == null) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm(call, async () => {
        const updated = await api.todosComplete(id);
        await refresh(true);
        return JSON.stringify(updated);
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmShell
      label="할 일 완료 제안"
      err={err}
      busy={busy}
      disabled={id == null}
      confirmLabel="완료"
      onConfirm={onConfirm}
      onDismiss={() => void reject(call)}
    >
      <p className="text-sm font-medium">
        {target?.title ?? (id != null ? `#${id}` : "(id 없음)")}
      </p>
      {target?.due_at && (
        <p className="text-[11px] text-fg-muted">
          마감: <span className="font-mono">{prettyDate(target.due_at)}</span>
        </p>
      )}
    </ConfirmShell>
  );
}

function DeleteTodoCard({ call }: Props) {
  const confirm = useChatStore((s) => s.confirmTool);
  const reject = useChatStore((s) => s.rejectTool);
  const refresh = useTodoStore((s) => s.refresh);
  const todos = useTodoStore((s) => s.todos);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const args = call.arguments as { id?: number };
  const id = typeof args.id === "number" ? args.id : null;
  const target = id != null ? todos.find((t) => t.id === id) : null;

  const onConfirm = async () => {
    if (id == null) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm(call, async () => {
        await api.todosDelete(id);
        await refresh(true);
        return JSON.stringify({ ok: true, deleted_id: id });
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmShell
      label="할 일 삭제 제안"
      err={err}
      busy={busy}
      disabled={id == null}
      confirmLabel="삭제"
      destructive
      onConfirm={onConfirm}
      onDismiss={() => void reject(call)}
    >
      <p className="text-sm font-medium">
        {target?.title ?? (id != null ? `#${id}` : "(id 없음)")}
      </p>
    </ConfirmShell>
  );
}

function CreateEventCard({ call }: Props) {
  const confirm = useChatStore((s) => s.confirmTool);
  const reject = useChatStore((s) => s.rejectTool);
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
      await confirm(call, async () => {
        const created = await api.calendarCreateEvent({
          summary: args.summary!,
          description: args.description ?? null,
          location: args.location ?? null,
          start_at: args.start_at!,
          end_at: args.end_at!,
          all_day: args.all_day ?? false,
        });
        return JSON.stringify(created);
      });
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
      onDismiss={() => void reject(call)}
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

function UpdateEventCard({ call }: Props) {
  const confirm = useChatStore((s) => s.confirmTool);
  const reject = useChatStore((s) => s.rejectTool);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const args = call.arguments as {
    google_event_id?: string;
    summary?: string;
    start_at?: string;
    end_at?: string;
    description?: string;
    location?: string;
    all_day?: boolean;
  };

  const patch = buildEventPatch(args);
  const id = args.google_event_id;
  const hasChanges = Object.keys(patch).length > 0;
  const validates = Boolean(id) && hasChanges;

  const onConfirm = async () => {
    if (!validates) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm(call, async () => {
        const updated = await api.calendarUpdateEvent(id!, patch);
        return JSON.stringify(updated);
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmShell
      label="캘린더 이벤트 수정 제안"
      err={err}
      busy={busy}
      disabled={!validates}
      confirmLabel="수정"
      onConfirm={onConfirm}
      onDismiss={() => void reject(call)}
    >
      {args.summary !== undefined && (
        <p className="text-[11px] text-fg-muted">
          제목 → <span className="font-medium text-fg">{args.summary}</span>
        </p>
      )}
      {args.start_at && args.end_at && (
        <p className="text-[11px] text-fg-muted">
          시간 → {prettyRange(args.start_at, args.end_at, args.all_day ?? false)}
        </p>
      )}
      {args.location !== undefined && (
        <p className="text-[11px] text-fg-muted">📍 → {args.location}</p>
      )}
      {args.description !== undefined && (
        <p className="line-clamp-3 text-[11px] text-fg-subtle">
          설명 → {args.description}
        </p>
      )}
      {!hasChanges && (
        <p className="text-[11px] text-fg-subtle">변경할 내용이 없습니다.</p>
      )}
    </ConfirmShell>
  );
}

function DeleteEventCard({ call }: Props) {
  const confirm = useChatStore((s) => s.confirmTool);
  const reject = useChatStore((s) => s.rejectTool);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const args = call.arguments as {
    google_event_id?: string;
    summary?: string;
    start_at?: string;
    end_at?: string;
  };
  const id = args.google_event_id;

  const onConfirm = async () => {
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm(call, async () => {
        await api.calendarDeleteEvent(id);
        return JSON.stringify({ ok: true, deleted_google_event_id: id });
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmShell
      label="캘린더 이벤트 삭제 제안"
      err={err}
      busy={busy}
      disabled={!id}
      confirmLabel="삭제"
      destructive
      onConfirm={onConfirm}
      onDismiss={() => void reject(call)}
    >
      <p className="text-sm font-medium">{args.summary ?? id ?? "(이벤트 없음)"}</p>
      {args.start_at && args.end_at && (
        <p className="text-[11px] text-fg-muted">
          {prettyRange(args.start_at, args.end_at, false)}
        </p>
      )}
    </ConfirmShell>
  );
}

function RememberFactCard({ call }: Props) {
  const confirm = useChatStore((s) => s.confirmTool);
  const reject = useChatStore((s) => s.rejectTool);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const args = call.arguments as { content?: string; tags?: string[] };
  const content = args.content?.trim() ?? "";
  const tags = Array.isArray(args.tags) ? args.tags : [];

  const onConfirm = async () => {
    if (!content) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm(call, async () => {
        const saved = await api.memoryRemember({ content, tags });
        return JSON.stringify(saved);
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmShell
      label="기억하기 제안"
      err={err}
      busy={busy}
      disabled={!content}
      confirmLabel="저장"
      onConfirm={onConfirm}
      onDismiss={() => void reject(call)}
    >
      <p className="text-sm font-medium">{content || "(내용 없음)"}</p>
      {tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
    </ConfirmShell>
  );
}

interface ConfirmShellProps {
  label: string;
  err: string | null;
  busy: boolean;
  disabled: boolean;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  children: React.ReactNode;
}

function ConfirmShell({
  label,
  err,
  busy,
  disabled,
  confirmLabel,
  destructive,
  onConfirm,
  onDismiss,
  children,
}: ConfirmShellProps) {
  const buttonClass = destructive
    ? "flex flex-1 items-center justify-center gap-1 rounded-md bg-red-500/85 px-2 py-1 text-bg transition-opacity disabled:opacity-40"
    : "flex flex-1 items-center justify-center gap-1 rounded-md bg-accent/85 px-2 py-1 text-bg transition-opacity disabled:opacity-40";
  const borderClass = destructive
    ? "rounded-md border border-red-400/30 bg-red-500/10 p-2.5 text-xs text-fg"
    : "rounded-md border border-accent/30 bg-accent/10 p-2.5 text-xs text-fg";
  const labelClass = destructive
    ? "mb-1.5 text-[11px] uppercase tracking-wider text-red-300"
    : "mb-1.5 text-[11px] uppercase tracking-wider text-accent";
  return (
    <div className={borderClass}>
      <div className={labelClass}>{label}</div>
      <div className="space-y-1">{children}</div>
      {err && <p className="mt-1.5 text-[11px] text-red-300">{err}</p>}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onConfirm}
          className={buttonClass}
        >
          <Check size={12} />
          <span className="text-[11px] font-medium">
            {busy ? "..." : confirmLabel ?? "추가"}
          </span>
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
