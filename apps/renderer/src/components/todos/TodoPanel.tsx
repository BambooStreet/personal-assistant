import { ChevronDown, Clock, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/cn";
import { TRIGGERS } from "../../lib/triggers";
import type { Todo, TodoDraft } from "../../lib/api";
import { useGoalStore } from "../../stores/useGoalStore";
import { useTodoStore } from "../../stores/useTodoStore";
import { useUiStore } from "../../stores/useUiStore";

const MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120, 180];
const DIFFICULTIES = ["하", "중", "상"];

export function TodoPanel() {
  const todos = useTodoStore((s) => s.todos);
  const refresh = useTodoStore((s) => s.refresh);
  const create = useTodoStore((s) => s.create);
  const update = useTodoStore((s) => s.update);
  const toggle = useTodoStore((s) => s.toggle);
  const remove = useTodoStore((s) => s.remove);
  const error = useTodoStore((s) => s.error);

  const goals = useGoalStore((s) => s.goals);
  const refreshGoals = useGoalStore((s) => s.refresh);
  const setMainTab = useUiStore((s) => s.setMainTab);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    refresh(true);
    // 연결된 목표 칩에 이름을 찍어야 해서 목표도 같이 읽는다.
    void refreshGoals();
  }, [refresh, refreshGoals]);

  const goalOptions = useMemo(
    () => goals.map((g) => ({ id: g.id, title: g.title })),
    [goals],
  );
  const goalName = useMemo(() => {
    const m = new Map(goals.map((g) => [g.id, g.title]));
    // 목표가 지워지면 고아 id가 남는다 — 이름을 못 찾으면 연결 없음으로 친다.
    return (id: number | null) => (id === null ? null : (m.get(id) ?? null));
  }, [goals]);

  const open = todos.filter((t) => !t.done);
  const routines = open.filter((t) => !!t.recur);
  // 시안의 묶음은 둘뿐이다. 마감 없는 일회성 할 일(과거 데이터나 마감을 비운 경우)도
  // 여기 넣되 맨 뒤로 — 별도 섹션을 만들면 시안에 없는 구획이 생기고, 빼면 화면에서
  // 조용히 사라진다.
  const deadline = open
    .filter((t) => !t.recur)
    .sort((a, b) => (a.due_at ?? "￿").localeCompare(b.due_at ?? "￿"));
  const done = todos.filter((t) => t.done);

  const renderRow = (t: Todo) =>
    editingId === t.id ? (
      <TaskForm
        key={t.id}
        todo={t}
        goals={goalOptions}
        onSave={async (draft) => {
          await update(t.id, draft);
          setEditingId(null);
        }}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <TaskRow
        key={t.id}
        todo={t}
        goalName={goalName(t.goal_id)}
        onToggle={() => void toggle(t.id, !t.done)}
        onEdit={() => {
          setAdding(false);
          setEditingId(t.id);
        }}
        onRemove={() => void remove(t.id)}
        onOpenGoal={() => setMainTab("goals")}
      />
    );

  return (
    <div className="panel-scroll h-full pb-5 pl-4 pr-2 pt-3.5 text-xs">
      {adding ? (
        <TaskForm
          goals={goalOptions}
          onSave={async (draft) => {
            await create(draft);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setAdding(true);
          }}
          className="no-drag mb-3.5 flex w-full items-center gap-2 rounded border border-dashed border-line px-3 py-2.5 text-[12.5px] text-fg-muted hover:border-gold hover:text-accent"
        >
          <span className="text-[15px] leading-none text-gold">+</span>새 할 일 추가
        </button>
      )}

      {error && (
        <p className="mb-3 rounded border border-rose/40 bg-rose/10 p-2 text-xs text-rose">
          {error}
        </p>
      )}

      {todos.length === 0 && !adding && (
        <p className="py-8 text-center text-[13px] text-fg-muted">
          아직 할 일이 없어요.
        </p>
      )}

      {routines.length > 0 && (
        <Section
          icon={<RotateCcw size={13} className="text-teal" />}
          label="반복 루틴"
        >
          {routines.map(renderRow)}
        </Section>
      )}

      {deadline.length > 0 && (
        <Section
          icon={<Clock size={13} className="text-rose" />}
          label="마감 있는 할 일"
        >
          {deadline.map(renderRow)}
        </Section>
      )}

      {done.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="no-drag mb-2.5 flex w-full items-center gap-2"
          >
            <ChevronDown
              size={13}
              className={cn(
                "shrink-0 text-fg-muted transition-transform",
                !showDone && "-rotate-90",
              )}
            />
            <span className="shrink-0 text-xs font-semibold tracking-[0.1em] text-fg">
              완료된 할 일
            </span>
            <span className="h-px flex-1 bg-line" />
          </button>
          {showDone && (
            <div className="flex flex-col gap-[7px]">{done.map(renderRow)}</div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold tracking-[0.1em] text-fg">
          {label}
        </span>
      </div>
      <div className="flex flex-col gap-[7px]">{children}</div>
    </div>
  );
}

function TaskRow({
  todo,
  goalName,
  onToggle,
  onEdit,
  onRemove,
  onOpenGoal,
}: {
  todo: Todo;
  goalName: string | null;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onOpenGoal: () => void;
}) {
  const isRecur = !!todo.recur;
  // 반복 항목의 due_at은 "다음 발생"이라 마감이 아니다 — 급하다고 붉게 칠하면 거짓말.
  const due = !isRecur && todo.due_at ? dueChip(todo.due_at) : null;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded border bg-bg-panel px-3 py-2.5 hover:border-gold",
        due?.urgent && !todo.done ? "border-rose" : "border-line",
        todo.done && "opacity-50",
      )}
    >
      {/* 반복은 원형, 마감은 사각 — 체크박스 모양만으로 성격이 구분된다. */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={todo.done}
        aria-label={todo.done ? "완료 해제" : "완료"}
        className={cn(
          "no-drag flex h-[17px] w-[17px] shrink-0 items-center justify-center border-[1.5px]",
          isRecur ? "rounded-full" : "rounded",
          todo.done ? "border-sage bg-sage" : "border-line bg-bg-panel",
        )}
      >
        {todo.done && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 5.2l2 2L8 3"
              className="stroke-bg-panel"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[13.5px] font-medium text-fg",
            todo.done && "line-through",
          )}
        >
          {todo.title}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {isRecur && todo.trigger_slot && (
            <Chip className="text-teal">{todo.trigger_slot}</Chip>
          )}
          {due && (
            <span
              className={cn(
                "whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                due.urgent
                  ? "bg-rose text-bg-panel"
                  : "border border-line text-fg-muted",
              )}
            >
              {due.label}
            </span>
          )}
          {todo.estimated_minutes !== null && (
            <Chip>◷ {minutesLabel(todo.estimated_minutes)}</Chip>
          )}
          {todo.difficulty && (
            <Chip className={difficultyColor(todo.difficulty)}>
              난이도 {todo.difficulty}
            </Chip>
          )}
          {goalName && (
            <button
              type="button"
              onClick={onOpenGoal}
              className="no-drag whitespace-nowrap rounded-full bg-halo px-2 py-0.5 text-[10.5px] text-accent hover:underline"
            >
              ◎ {goalName}
            </button>
          )}
        </div>
        {todo.notes && (
          <p className="mt-1 truncate text-[11px] text-fg-muted">{todo.notes}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="no-drag invisible shrink-0 p-1 text-fg-muted hover:text-accent group-hover:visible"
        aria-label="수정"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="no-drag invisible shrink-0 p-1 text-fg-muted hover:text-rose group-hover:visible"
        aria-label="삭제"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[10.5px] text-fg-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * 할 일 추가/편집 공용 폼. `todo`가 있으면 편집이다.
 *
 * notes·priority는 UI에 없지만 **기존 값을 그대로 실어 보낸다** — update가 draft 전체
 * 교체라 빼면 조용히 지워진다.
 */
function TaskForm({
  todo,
  goals,
  onSave,
  onCancel,
}: {
  todo?: Todo;
  goals: { id: number; title: string }[];
  onSave: (draft: TodoDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [isRecur, setIsRecur] = useState(!!todo?.recur);
  const [title, setTitle] = useState(todo?.title ?? "");
  const [minutes, setMinutes] = useState(todo?.estimated_minutes ?? 30);
  const [difficulty, setDifficulty] = useState(todo?.difficulty ?? "중");
  const [goalId, setGoalId] = useState(
    todo?.goal_id !== null && todo?.goal_id !== undefined
      ? String(todo.goal_id)
      : "",
  );
  const [trigger, setTrigger] = useState(todo?.trigger_slot ?? TRIGGERS[0]);
  const [due, setDue] = useState(todo?.due_at ? todo.due_at.slice(0, 10) : "");

  const save = () => {
    const t = title.trim();
    if (!t) return;
    void onSave({
      title: t,
      notes: todo?.notes ?? null,
      priority: todo?.priority ?? 0,
      estimated_minutes: minutes,
      difficulty,
      goal_id: goalId ? Number(goalId) : null,
      // 반복은 매일 전제 — 빈도는 고르지 않는다. 트리거가 "언제 하는가"를 담는다.
      recur: isRecur ? "daily" : null,
      trigger_slot: isRecur ? trigger : null,
      // 반복인데 첫 발생이 없으면 지금으로 — 없으면 목록에서 안 보인다.
      due_at: isRecur
        ? (todo?.due_at ?? new Date().toISOString())
        : due
          ? `${due}T23:59:00`
          : null,
    });
  };

  return (
    <div className="no-drag mb-4 rounded border border-gold-soft bg-bg-elevated p-3.5">
      <div className="mb-2.5 flex gap-1.5">
        <TypeButton active={isRecur} onClick={() => setIsRecur(true)}>
          반복 할 일
        </TypeButton>
        <TypeButton active={!isRecur} onClick={() => setIsRecur(false)}>
          마감 할 일
        </TypeButton>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
        }}
        placeholder="무엇을 해야 하나요?"
        className="mb-2.5 h-[34px] w-full rounded border border-line bg-bg-panel px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-gold"
      />

      <div className="mb-2.5 grid grid-cols-4 gap-2">
        <Field label="예상 소요">
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className={SELECT_CLS}
          >
            {MINUTE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {minutesLabel(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="난이도">
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className={SELECT_CLS}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="연결된 목표">
          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">없음</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </Field>
        {isRecur ? (
          <Field label="언제">
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              className={SELECT_CLS}
            >
              {TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="마감일">
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className={SELECT_CLS}
            />
          </Field>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-line px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
        >
          취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!title.trim()}
          className="rounded bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-40"
        >
          {todo ? "저장" : "추가"}
        </button>
      </div>
    </div>
  );
}

const SELECT_CLS =
  "h-[31px] w-full min-w-0 rounded border border-line bg-bg-panel px-1.5 text-xs text-fg outline-none focus:border-gold";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 truncate text-[10.5px] tracking-[0.04em] text-fg-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function TypeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold",
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-line text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function minutesLabel(m: number): string {
  if (m < 60) return `${m}분`;
  if (m === 90) return "1.5시간";
  if (m >= 180) return "3시간+";
  return `${m / 60}시간`;
}

function difficultyColor(d: string): string {
  if (d === "하") return "text-sage";
  if (d === "상") return "text-rose";
  return "text-gold";
}

/** 마감 칩. 오늘이면 강조(행 테두리까지 붉게), 일주일 안이면 D-n, 그 밖은 날짜. */
function dueChip(iso: string): { label: string; urgent: boolean } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: "", urgent: false };
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  if (days < 0) return { label: `${-days}일 지남`, urgent: true };
  if (days === 0) return { label: "오늘 마감", urgent: true };
  if (days <= 7) return { label: `D-${days}`, urgent: false };
  return { label: `${d.getMonth() + 1}/${d.getDate()} 마감`, urgent: false };
}
