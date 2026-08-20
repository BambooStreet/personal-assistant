import { ChevronDown, Pencil, Plus, Target, Trash2, X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

import { cn } from "../../lib/cn";
import type { GoalDetail, GoalDraft } from "../../lib/api";
import { useGoalStore } from "../../stores/useGoalStore";

// 요일 비트마스크: bit0=월 … bit6=일. Core(`services/goals/pure.rs`)와 같은 규약.
// ⚠️ 같은 폴더의 DateField 달력은 0=일 기준이라 다르다 — 여기서 그쪽 코드를 복사해 오지 말 것.
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const DAILY_MASK = 0b111_1111;

function toggleDayBit(mask: number, day: number): number {
  return mask ^ (1 << day);
}

// ===== 목표 섹션 =====

export function GoalSection() {
  const goals = useGoalStore((s) => s.goals);
  const error = useGoalStore((s) => s.error);
  const refresh = useGoalStore((s) => s.refresh);
  const create = useGoalStore((s) => s.create);
  const update = useGoalStore((s) => s.update);
  const remove = useGoalStore((s) => s.remove);

  // 기본 접힘 — 목표는 정해두면 거의 안 들어오는 화면이다. 실제 접점은 브리핑과 알림.
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async (draft: GoalDraft) => {
    const created = await create(draft);
    if (created) setAdding(false);
  };

  const onUpdate = async (id: number, draft: GoalDraft) => {
    const updated = await update(id, draft);
    if (updated) setEditingId(null);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="no-drag flex items-center gap-1 text-xs uppercase tracking-wider text-fg-subtle hover:text-fg"
        >
          <ChevronDown
            size={12}
            className={cn("transition-transform", open && "rotate-180")}
          />
          <Target size={11} /> 목표 ({goals.length})
        </button>
        {open && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding((v) => !v);
            }}
            className="no-drag flex items-center gap-1 rounded px-1 py-0.5 text-xs text-fg-subtle hover:text-accent"
            aria-label="목표 추가"
          >
            <Plus size={11} /> 목표
          </button>
        )}
      </div>

      {open && (
        <>
          {adding && (
            <GoalForm
              onSave={onCreate}
              onCancel={() => setAdding(false)}
            />
          )}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
              {error}
            </div>
          )}

          {goals.length === 0 && !adding ? (
            <p className="px-2 py-2 text-center text-xs text-fg-subtle">
              아직 목표가 없어요
            </p>
          ) : (
            <ul className="space-y-1">
              {goals.map((g) =>
                editingId === g.id ? (
                  <li key={g.id}>
                    <GoalForm
                      goal={g}
                      onSave={(d) => onUpdate(g.id, d)}
                      onCancel={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <li key={g.id}>
                    <GoalRow
                      goal={g}
                      onEdit={() => {
                        setAdding(false);
                        setEditingId(g.id);
                      }}
                      onRemove={() => void remove(g.id)}
                    />
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ===== 목표 한 줄 =====

function GoalRow({
  goal,
  onEdit,
  onRemove,
}: {
  goal: GoalDetail;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const addRoutine = useGoalStore((s) => s.addRoutine);
  const removeRoutine = useGoalStore((s) => s.removeRoutine);
  const [addingRoutine, setAddingRoutine] = useState(false);

  return (
    <div className="no-drag group rounded-md border border-white/5 bg-bg-elevated/50 p-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-fg">{goal.title}</p>
        <button
          type="button"
          onClick={onEdit}
          className="invisible flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-white/10 hover:text-accent group-hover:visible"
          aria-label="수정"
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="invisible flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-red-500/20 hover:text-red-300 group-hover:visible"
          aria-label="삭제"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1">
        {goal.routines.map((r) => (
          <span
            key={r.id}
            className="flex items-center gap-0.5 rounded bg-accent/15 px-1 py-0.5 text-xs text-accent"
          >
            {r.days_label} {r.time_hhmm}
            <button
              type="button"
              onClick={() => void removeRoutine(r.id)}
              className="ml-0.5 opacity-60 hover:opacity-100"
              aria-label="루틴 삭제"
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAddingRoutine((v) => !v)}
          className="rounded px-1 py-0.5 text-xs text-fg-subtle hover:text-accent"
        >
          + 루틴
        </button>
      </div>

      {addingRoutine && (
        <RoutineForm
          onSave={async (time_hhmm, days_mask) => {
            await addRoutine({ goal_id: goal.id, time_hhmm, days_mask });
            setAddingRoutine(false);
          }}
          onCancel={() => setAddingRoutine(false)}
        />
      )}

      {goal.whys.length > 0 && (
        <p className="mt-1 truncate text-xs text-fg-subtle">
          {goal.whys.map((w) => w.text).join(" · ")}
        </p>
      )}
    </div>
  );
}

// ===== 목표 추가/수정 폼 =====

function GoalForm({
  goal,
  onSave,
  onCancel,
}: {
  goal?: GoalDetail;
  onSave: (draft: GoalDraft) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? "");
  // '왜'는 여러 개 — 한 줄에 하나. 알림에서 날마다 번갈아 쓰인다.
  const [whys, setWhys] = useState(
    (goal?.whys ?? []).map((w) => w.text).join("\n"),
  );

  const save = () => {
    const t = title.trim();
    if (!t) return;
    void onSave({
      title: t,
      whys: whys
        .split("\n")
        .map((w) => w.trim())
        .filter(Boolean),
    });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className="no-drag flex flex-col gap-2 rounded-md border border-accent/30 bg-bg-elevated/70 p-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKey}
        placeholder="목표 (예: 영어 회화)"
        className="rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
      />
      <textarea
        value={whys}
        onChange={(e) => setWhys(e.target.value)}
        rows={2}
        placeholder="왜 하고 싶은지 (한 줄에 하나. 알림에 번갈아 나와요)"
        className="resize-none rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-subtle hover:text-fg"
        >
          <X size={11} /> 취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!title.trim()}
          className="rounded-md bg-accent/80 px-3 py-1 text-xs font-medium text-bg disabled:opacity-40"
        >
          저장
        </button>
      </div>
    </div>
  );
}

// ===== 루틴 추가 폼 =====

function RoutineForm({
  onSave,
  onCancel,
}: {
  onSave: (timeHhmm: string, daysMask: number) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [time, setTime] = useState("22:00");
  const [mask, setMask] = useState(DAILY_MASK);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-white/5 bg-bg/40 p-2">
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="no-drag rounded-md border border-white/10 bg-bg/60 px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent/60"
        />
        <button
          type="button"
          onClick={() => setMask(DAILY_MASK)}
          className={cn(
            "rounded-md px-1.5 py-0.5 text-xs",
            mask === DAILY_MASK
              ? "bg-accent/80 text-bg"
              : "border border-white/10 text-fg-muted hover:text-fg",
          )}
        >
          매일
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {DAY_LABELS.map((d, day) => (
          <button
            key={day}
            type="button"
            onClick={() => setMask((m) => toggleDayBit(m, day))}
            className={cn(
              "no-drag h-6 w-6 rounded-md text-xs transition-colors",
              mask & (1 << day)
                ? "bg-accent/80 text-bg"
                : "border border-white/10 text-fg-muted hover:text-fg",
            )}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-fg-subtle hover:text-fg"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void onSave(time, mask)}
          disabled={mask === 0 || !time}
          className="rounded-md bg-accent/80 px-3 py-1 text-xs font-medium text-bg disabled:opacity-40"
        >
          추가
        </button>
      </div>
    </div>
  );
}
