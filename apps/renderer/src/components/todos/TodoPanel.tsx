import { ChevronDown, Clock, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/cn";
import { dueChip } from "../../lib/dueLabel";
import type { Todo } from "../../lib/api";

import { TaskForm, minutesLabel } from "./TaskForm";
import { useGoalStore } from "../../stores/useGoalStore";
import { useTodoStore } from "../../stores/useTodoStore";
import { useUiStore } from "../../stores/useUiStore";


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

function difficultyColor(d: string): string {
  if (d === "하") return "text-sage";
  if (d === "상") return "text-rose";
  return "text-gold";
}
