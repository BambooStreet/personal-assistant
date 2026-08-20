import {
  CalendarPlus,
  Check,
  ChevronDown,
  Circle,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { format, isPast, isToday, parseISO } from "date-fns";

import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { StoredEventLite, Todo, TodoDraft } from "../../lib/api";
import { useTodoStore } from "../../stores/useTodoStore";
import { useCalendarStore } from "../../stores/useCalendarStore";
import { useGoalStore } from "../../stores/useGoalStore";
import { DateField } from "./DateField";
import { GoalSection } from "./GoalSection";

type Recur = "" | "daily" | "weekly" | "monthly";

const RECUR_LABEL: Record<string, string> = {
  daily: "매일",
  weekly: "매주",
  monthly: "매월",
};

// datetime-local 입력값("YYYY-MM-DDTHH:mm", 로컬)을 RFC3339(UTC ISO)로 변환.
function localToIso(local: string): string {
  return new Date(local).toISOString();
}

// 저장된 ISO(UTC)를 datetime-local 로컬 문자열로 역변환(편집 시 기존 기한 표시용).
function isoToLocal(iso: string): string {
  try {
    return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm");
  } catch {
    return "";
  }
}

export function TodoPanel() {
  const todos = useTodoStore((s) => s.todos);
  const refresh = useTodoStore((s) => s.refresh);
  const create = useTodoStore((s) => s.create);
  const update = useTodoStore((s) => s.update);
  const toggle = useTodoStore((s) => s.toggle);
  const remove = useTodoStore((s) => s.remove);
  const error = useTodoStore((s) => s.error);

  const events = useCalendarStore((s) => s.events);
  const refreshToday = useCalendarStore((s) => s.refreshToday);
  const goalCount = useGoalStore((s) => s.goals.length);

  const [editingId, setEditingId] = useState<number | null>(null);
  const onEditSave = async (id: number, draft: TodoDraft) => {
    await update(id, draft);
    setEditingId(null);
  };

  useEffect(() => {
    refresh(true);
    void refreshToday();
    // 백그라운드 동기화 완료 시 캘린더 섹션 자동 갱신.
    const off = api.on("calendar.synced", () => void refreshToday());
    return () => off();
  }, [refresh, refreshToday]);

  // 버킷 분류. 반복(recur)은 완료 시 다음 주기로 전진하므로 done에 남지 않는다.
  const open = todos.filter((t) => !t.done);
  const deadline = open.filter((t) => !t.recur && t.due_at);
  const routines = open.filter((t) => !!t.recur);
  const backlog = open.filter((t) => !t.recur && !t.due_at);
  const done = todos.filter((t) => t.done);

  const empty =
    todos.length === 0 && events.length === 0 && goalCount === 0;

  return (
    <div className="flex h-full flex-col">
      <AddTodoForm onCreate={create} />

      <div className="flex-1 space-y-3 overflow-y-auto p-2 text-xs">
        <CalendarSection events={events} />

        <GoalSection />

        {empty && (
          <p className="px-2 py-6 text-center text-fg-subtle">
            아직 관리할 항목이 없어요.
          </p>
        )}

        {deadline.length > 0 && (
          <Section
            label={`⏰ 기한 있는 할 일 (${deadline.length})`}
            items={deadline}
            onToggle={(id, d) => void toggle(id, d)}
            onRemove={(id) => void remove(id)}
            editingId={editingId}
            onEditStart={setEditingId}
            onEditSave={onEditSave}
            onEditCancel={() => setEditingId(null)}
          />
        )}

        {routines.length > 0 && (
          <Section
            label={`🔁 반복 / 루틴 (${routines.length})`}
            items={routines}
            onToggle={(id, d) => void toggle(id, d)}
            onRemove={(id) => void remove(id)}
            editingId={editingId}
            onEditStart={setEditingId}
            onEditSave={onEditSave}
            onEditCancel={() => setEditingId(null)}
          />
        )}

        {backlog.length > 0 && (
          <Section
            label={`💡 언젠가 / 백로그 (${backlog.length})`}
            items={backlog}
            onToggle={(id, d) => void toggle(id, d)}
            onRemove={(id) => void remove(id)}
            editingId={editingId}
            onEditStart={setEditingId}
            onEditSave={onEditSave}
            onEditCancel={() => setEditingId(null)}
          />
        )}

        {done.length > 0 && (
          <Section
            label={`✓ 완료 (${done.length})`}
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

// ===== 할 일 입력 (제목 + 접이식 옵션: 기한 / 반복) =====

function AddTodoForm({
  onCreate,
}: {
  onCreate: (draft: TodoDraft) => Promise<Todo | null>;
}) {
  const [draft, setDraft] = useState("");
  const [showOpts, setShowOpts] = useState(false);
  const [due, setDue] = useState("");
  const [recur, setRecur] = useState<Recur>("");
  const [est, setEst] = useState("");

  const onAdd = async () => {
    const t = draft.trim();
    if (!t) return;
    const payload: TodoDraft = { title: t };
    if (due) payload.due_at = localToIso(due);
    if (recur) {
      payload.recur = recur;
      // 반복인데 기한 미지정이면 오늘(지금)을 첫 발생으로 — 루틴이 즉시 보이도록.
      if (!due) payload.due_at = new Date().toISOString();
    }
    const estNum = parseInt(est, 10);
    if (Number.isFinite(estNum) && estNum > 0) payload.estimated_minutes = estNum;
    setDraft("");
    setDue("");
    setRecur("");
    setEst("");
    setShowOpts(false);
    await onCreate(payload);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void onAdd();
    }
  };

  return (
    <div className="no-drag border-b border-white/5 p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowOpts((v) => !v)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-fg-subtle hover:text-fg",
            showOpts && "text-accent",
          )}
          aria-label="옵션"
        >
          <ChevronDown
            size={14}
            className={cn("transition-transform", showOpts && "rotate-180")}
          />
        </button>
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

      {showOpts && (
        <div className="mt-2 flex flex-col gap-2 pl-9">
          <div className="flex items-center gap-2 text-[11px] text-fg-muted">
            <span className="w-8 shrink-0">기한</span>
            <DateField value={due} onChange={setDue} placeholder="기한 선택" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-fg-muted">
            <span className="w-8 shrink-0">반복</span>
            <select
              value={recur}
              onChange={(e) => setRecur(e.target.value as Recur)}
              className="flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[11px] text-fg outline-none focus:border-accent/60"
            >
              <option value="">없음</option>
              <option value="daily">매일</option>
              <option value="weekly">매주</option>
              <option value="monthly">매월</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-fg-muted">
            <span className="w-8 shrink-0">소요</span>
            <input
              type="number"
              min={1}
              value={est}
              onChange={(e) => setEst(e.target.value)}
              placeholder="분 (예: 30) — 일과 자동배치에 사용"
              className="flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ===== 캘린더 섹션 (오늘 일정 읽기전용 + 빠른 추가) =====

function CalendarSection({ events }: { events: StoredEventLite[] }) {
  const createEvent = useCalendarStore((s) => s.createEvent);
  const [adding, setAdding] = useState(false);
  const [summary, setSummary] = useState("");
  const [start, setStart] = useState("");

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
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] uppercase tracking-wider text-fg-subtle">
          📅 오늘 일정 ({events.length})
        </p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="no-drag flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-fg-subtle hover:text-accent"
          aria-label="일정 추가"
        >
          <CalendarPlus size={11} /> 일정
        </button>
      </div>

      {adding && (
        <div className="no-drag flex flex-col gap-2 rounded-md border border-white/5 bg-bg-elevated/50 p-2">
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="일정 제목"
            className="rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
          />
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[11px] text-fg outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={!summary.trim() || !start}
              className="rounded-md bg-accent/85 px-2 py-1 text-[11px] text-bg disabled:opacity-40"
            >
              추가
            </button>
          </div>
        </div>
      )}

      {events.length === 0 && !adding ? (
        <p className="px-2 py-2 text-center text-[11px] text-fg-subtle">
          오늘 일정 없음
        </p>
      ) : (
        <ul className="space-y-1">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-md border border-white/5 bg-bg-elevated/30 p-2"
            >
              <span className="w-12 shrink-0 text-[10px] tabular-nums text-accent/80">
                {eventTime(e)}
              </span>
              <span className="flex-1 truncate text-[12px] text-fg-muted">
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

// ===== 할 일 리스트 섹션 (버킷 공용) =====

interface SectionProps {
  label: string;
  items: Todo[];
  muted?: boolean;
  onToggle: (id: number, done: boolean) => void;
  onRemove: (id: number) => void;
  editingId?: number | null;
  onEditStart?: (id: number) => void;
  onEditSave?: (id: number, draft: TodoDraft) => void | Promise<void>;
  onEditCancel?: () => void;
}

function Section({
  label,
  items,
  muted,
  onToggle,
  onRemove,
  editingId,
  onEditStart,
  onEditSave,
  onEditCancel,
}: SectionProps) {
  return (
    <div className="space-y-1">
      <p className="px-1 text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <ul className="space-y-1">
        {items.map((t) =>
          editingId === t.id && onEditSave && onEditCancel ? (
            <li key={t.id}>
              <EditTodoForm
                todo={t}
                onSave={onEditSave}
                onCancel={onEditCancel}
              />
            </li>
          ) : (
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
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p
                  className={cn(
                    "truncate text-[12px]",
                    t.done && "text-fg-muted line-through",
                  )}
                >
                  {t.title}
                </p>
                {t.recur && (
                  <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent/15 px-1 py-0.5 text-[9px] text-accent">
                    <Repeat size={8} />
                    {RECUR_LABEL[t.recur] ?? t.recur}
                  </span>
                )}
                {t.estimated_minutes != null && (
                  <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-[9px] text-fg-muted">
                    ⏱ {t.estimated_minutes}분
                  </span>
                )}
              </div>
              {t.due_at && (
                <DueLabel
                  due={t.due_at}
                  done={t.done}
                  recurring={!!t.recur}
                />
              )}
              {t.notes && (
                <p className="mt-0.5 truncate text-[10px] text-fg-subtle">
                  {t.notes}
                </p>
              )}
            </div>
            {onEditStart && (
              <button
                type="button"
                onClick={() => onEditStart(t.id)}
                className="invisible flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-white/10 hover:text-accent group-hover:visible"
                aria-label="수정"
              >
                <Pencil size={11} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(t.id)}
              className="invisible flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-red-500/20 hover:text-red-300 group-hover:visible"
              aria-label="삭제"
            >
              <Trash2 size={11} />
            </button>
          </li>
          ),
        )}
      </ul>
    </div>
  );
}

// ===== 할 일 인라인 편집 폼 (제목 / 기한 / 반복; 노트·우선순위는 보존) =====

function EditTodoForm({
  todo,
  onSave,
  onCancel,
}: {
  todo: Todo;
  onSave: (id: number, draft: TodoDraft) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [due, setDue] = useState(todo.due_at ? isoToLocal(todo.due_at) : "");
  const [recur, setRecur] = useState<Recur>((todo.recur as Recur) ?? "");
  const [est, setEst] = useState(
    todo.estimated_minutes != null ? String(todo.estimated_minutes) : "",
  );

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    const estNum = parseInt(est, 10);
    const payload: TodoDraft = {
      title: t,
      notes: todo.notes, // UI 미노출 — 기존 값 보존
      priority: todo.priority, // UI 미노출 — 기존 값 보존
      due_at: due ? localToIso(due) : null,
      recur: recur || null,
      estimated_minutes: Number.isFinite(estNum) && estNum > 0 ? estNum : null,
    };
    await onSave(todo.id, payload);
  };

  return (
    <div className="no-drag flex flex-col gap-2 rounded-md border border-accent/30 bg-bg-elevated/70 p-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목"
        className="rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[12px] text-fg outline-none focus:border-accent/60"
      />
      <div className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span className="w-8 shrink-0">기한</span>
        <DateField value={due} onChange={setDue} placeholder="기한 선택" />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span className="w-8 shrink-0">반복</span>
        <select
          value={recur}
          onChange={(e) => setRecur(e.target.value as Recur)}
          className="flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[11px] text-fg outline-none focus:border-accent/60"
        >
          <option value="">없음</option>
          <option value="daily">매일</option>
          <option value="weekly">매주</option>
          <option value="monthly">매월</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span className="w-8 shrink-0">소요</span>
        <input
          type="number"
          min={1}
          value={est}
          onChange={(e) => setEst(e.target.value)}
          placeholder="분"
          className="flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-subtle hover:text-fg"
        >
          <X size={11} /> 취소
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!title.trim()}
          className="rounded-md bg-accent/85 px-3 py-1 text-[11px] text-bg disabled:opacity-40"
        >
          저장
        </button>
      </div>
    </div>
  );
}

function DueLabel({
  due,
  done,
  recurring,
}: {
  due: string;
  done: boolean;
  recurring?: boolean;
}) {
  let label = due;
  let overdue = false;
  try {
    const d = parseISO(due);
    label = isToday(d) ? `오늘 ${format(d, "HH:mm")}` : format(d, "MM/dd HH:mm");
    // 반복 항목은 기한 초과를 빨강으로 강조하지 않음(자연스레 다음 주기로 넘어가므로).
    overdue = !done && !recurring && isPast(d);
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
      {recurring ? `다음: ${label}` : label}
    </p>
  );
}
