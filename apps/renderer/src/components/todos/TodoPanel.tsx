import { Check, Circle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { format, isPast, isToday, parseISO } from "date-fns";

import { cn } from "../../lib/cn";
import type { Todo } from "../../lib/runtime";
import { useTodoStore } from "../../stores/useTodoStore";

export function TodoPanel() {
  const todos = useTodoStore((s) => s.todos);
  const refresh = useTodoStore((s) => s.refresh);
  const create = useTodoStore((s) => s.create);
  const toggle = useTodoStore((s) => s.toggle);
  const remove = useTodoStore((s) => s.remove);
  const error = useTodoStore((s) => s.error);

  const [draft, setDraft] = useState("");

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  const onAdd = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    await create({ title: t });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void onAdd();
    }
  };

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="flex h-full flex-col">
      <div className="no-drag flex items-center gap-2 border-b border-white/5 p-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="새 할 일"
          className="flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
        />
        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={!draft.trim()}
          className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/85 text-bg disabled:opacity-40"
          aria-label="add"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2 text-xs">
        {open.length === 0 && done.length === 0 && (
          <p className="px-2 py-6 text-center text-fg-subtle">
            아직 할 일이 없어요.
          </p>
        )}

        {open.length > 0 && (
          <Section
            label={`열린 할 일 (${open.length})`}
            items={open}
            onToggle={(id, d) => void toggle(id, d)}
            onRemove={(id) => void remove(id)}
          />
        )}

        {done.length > 0 && (
          <Section
            label={`완료 (${done.length})`}
            items={done}
            onToggle={(id, d) => void toggle(id, d)}
            onRemove={(id) => void remove(id)}
            muted
          />
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

interface SectionProps {
  label: string;
  items: Todo[];
  muted?: boolean;
  onToggle: (id: number, done: boolean) => void;
  onRemove: (id: number) => void;
}

function Section({ label, items, muted, onToggle, onRemove }: SectionProps) {
  return (
    <div className="space-y-1">
      <p className="px-1 text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <ul className="space-y-1">
        {items.map((t) => (
          <li
            key={t.id}
            className={cn(
              "no-drag group flex items-start gap-2 rounded-md border border-white/5 bg-bg-elevated/50 p-2",
              muted && "opacity-60",
            )}
          >
            <button
              type="button"
              onClick={() => onToggle(t.id, !t.done)}
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/20 text-fg-muted hover:border-accent hover:text-accent"
              aria-label={t.done ? "되돌리기" : "완료"}
            >
              {t.done ? <Check size={10} /> : <Circle size={6} />}
            </button>
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "truncate text-[12px]",
                  t.done && "line-through text-fg-muted",
                )}
              >
                {t.title}
              </p>
              {t.due_at && <DueLabel due={t.due_at} done={t.done} />}
              {t.notes && (
                <p className="mt-0.5 truncate text-[10px] text-fg-subtle">
                  {t.notes}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onRemove(t.id)}
              className="invisible flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-red-500/20 hover:text-red-300 group-hover:visible"
              aria-label="삭제"
            >
              <Trash2 size={11} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DueLabel({ due, done }: { due: string; done: boolean }) {
  let label = due;
  let overdue = false;
  try {
    const d = parseISO(due);
    label = isToday(d) ? `오늘 ${format(d, "HH:mm")}` : format(d, "MM/dd HH:mm");
    overdue = !done && isPast(d);
  } catch {
    /* keep raw */
  }
  return (
    <p
      className={cn(
        "mt-0.5 text-[10px]",
        overdue ? "text-red-300" : "text-fg-muted",
      )}
    >
      {label}
    </p>
  );
}
