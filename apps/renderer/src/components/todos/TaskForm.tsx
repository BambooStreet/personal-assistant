import { useState } from "react";

import { cn } from "../../lib/cn";
import { TRIGGERS } from "../../lib/triggers";
import type { Todo, TodoDraft } from "../../lib/api";

const MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120, 180];
const DIFFICULTIES = ["하", "중", "상"];

/**
 * 할 일 추가/편집 공용 폼. `todo`가 있으면 편집이다.
 *
 * notes·priority는 UI에 없지만 **기존 값을 그대로 실어 보낸다** — update가 draft 전체
 * 교체라 빼면 조용히 지워진다.
 */
export function TaskForm({
  todo,
  goals,
  defaultGoalId,
  embedded,
  onSave,
  onCancel,
}: {
  todo?: Todo;
  goals: { id: number; title: string }[];
  /** 새로 만들 때 미리 골라둘 목표(목표 상세에서 추가하는 경우). */
  defaultGoalId?: number;
  /** 이미 테두리가 있는 상자 안에 넣을 때 — 자기 테두리·배경을 안 그린다. */
  embedded?: boolean;
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
      : defaultGoalId !== undefined
        ? String(defaultGoalId)
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
    <div
      className={cn(
        "no-drag",
        embedded
          ? ""
          : "mb-4 rounded border border-gold-soft bg-bg-elevated p-3.5",
      )}
    >
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
        autoFocus
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

export function minutesLabel(m: number): string {
  if (m < 60) return `${m}분`;
  if (m === 90) return "1.5시간";
  if (m >= 180) return "3시간+";
  return `${m / 60}시간`;
}
