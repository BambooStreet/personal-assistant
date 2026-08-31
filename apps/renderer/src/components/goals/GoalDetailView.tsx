import { ArrowLeft, Check, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/cn";
import type { GoalDetail } from "../../lib/api";
import { useGoalStore } from "../../stores/useGoalStore";
import { SectionHeader } from "../common/SectionHeader";

import { AscentPath } from "./AscentPath";
import { RoutineForm } from "./RoutineForm";

interface Props {
  goal: GoalDetail;
  onBack: () => void;
  onEditGoal: () => void;
}

/** 한 번에 한 섹션만 편집한다 — 두 곳을 동시에 고치면 저장 순서가 꼬인다. */
type EditSection = null | "why" | "milestone";

/**
 * 목표 상세. 섹션 순서는 고정이다: 이유 → 이정표 → 꾸준한 노력.
 * "왜 하는지"를 먼저 보고 "어디까지 왔는지"를 본 다음 "오늘 뭘 하는지"로 내려온다.
 */
export function GoalDetailView({ goal, onBack, onEditGoal }: Props) {
  const update = useGoalStore((s) => s.update);
  const toggleMilestone = useGoalStore((s) => s.toggleMilestone);
  const addRoutine = useGoalStore((s) => s.addRoutine);
  const removeRoutine = useGoalStore((s) => s.removeRoutine);
  const [editing, setEditing] = useState<EditSection>(null);
  const [addingRoutine, setAddingRoutine] = useState(false);

  // 편집 중인 섹션만 draft를 들고 나머지는 현재 값을 그대로 보낸다.
  const saveWhys = async (whys: string[]) => {
    await update(goal.id, {
      title: goal.title,
      target_ym: goal.target_ym,
      whys,
      milestones: goal.milestones.map((m) => ({ id: m.id, title: m.title })),
    });
    setEditing(null);
  };

  const saveMilestones = async (items: { id: number | null; title: string }[]) => {
    await update(goal.id, {
      title: goal.title,
      target_ym: goal.target_ym,
      whys: goal.whys.map((w) => w.text),
      milestones: items,
    });
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-2 text-xs">
      <div className="mb-3 flex items-start gap-2">
        <button
          type="button"
          onClick={onBack}
          className="no-drag mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg"
          aria-label="목표 목록으로"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-fg">{goal.title}</p>
          {goal.target_ym && (
            <p className="mt-0.5 text-[11px] text-fg-muted">
              목표 시점 {goal.target_ym}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onEditGoal}
          className="no-drag mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-accent"
          aria-label="목표 수정"
        >
          <Pencil size={12} />
        </button>
      </div>

      {/* ① 이유 */}
      <SectionHeader
        label="목표를 이루고 싶은 이유"
        action={
          <EditToggle
            active={editing === "why"}
            onClick={() => setEditing(editing === "why" ? null : "why")}
          />
        }
      />
      {editing === "why" ? (
        <StringListEditor
          initial={goal.whys.map((w) => w.text)}
          placeholder="새 이유"
          onSave={saveWhys}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <WhyList texts={goal.whys.map((w) => w.text)} />
      )}

      {/* ② 이정표 */}
      <div className="mt-5">
        <SectionHeader
          label="이정표"
          action={
            <EditToggle
              active={editing === "milestone"}
              onClick={() =>
                setEditing(editing === "milestone" ? null : "milestone")
              }
            />
          }
        />
        <div className="mb-2 flex items-center gap-2 px-1">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-elevated">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-soft to-gold transition-[width] duration-500"
              style={{ width: `${goal.progress}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-accent">
            {goal.progress}%
          </span>
        </div>

        {editing === "milestone" ? (
          <MilestoneEditor
            initial={goal.milestones.map((m) => ({ id: m.id, title: m.title }))}
            onSave={saveMilestones}
            onCancel={() => setEditing(null)}
          />
        ) : goal.milestones.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-fg-muted">
            아직 이정표가 없어요. 오른쪽 연필로 추가해요.
          </p>
        ) : (
          <AscentPath
            milestones={goal.milestones}
            onToggle={(id, done) => void toggleMilestone(id, done)}
          />
        )}
      </div>

      {/* ③ 꾸준한 노력 — 지금은 목표에 딸린 루틴 알림을 보여준다.
          디자인은 "트리거"(일어나자마자/자기 전…) 기준인데 그 전환은 아직이다. */}
      <div className="mt-5">
        <SectionHeader
          label="꾸준한 노력"
          action={
            <button
              type="button"
              onClick={() => setAddingRoutine((v) => !v)}
              className="no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-accent"
              aria-label="루틴 추가"
            >
              <Plus size={12} />
            </button>
          }
        />
        {goal.routines.length === 0 && !addingRoutine ? (
          <p className="px-2 py-3 text-center text-xs text-fg-muted">
            아직 루틴이 없어요.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {goal.routines.map((r) => (
              <li
                key={r.id}
                className="group flex items-center gap-2 px-1 py-2 text-xs text-fg"
              >
                <span className="h-3 w-3 shrink-0 rounded-full border border-line" />
                <span className="min-w-0 flex-1 truncate">{r.days_label}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-teal">
                  {r.time_hhmm}
                </span>
                <button
                  type="button"
                  onClick={() => void removeRoutine(r.id)}
                  className="no-drag invisible flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted hover:text-rose group-hover:visible"
                  aria-label="루틴 삭제"
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {addingRoutine && (
          <RoutineForm
            onSave={async (time_hhmm, days_mask) => {
              await addRoutine({ goal_id: goal.id, time_hhmm, days_mask });
              setAddingRoutine(false);
            }}
            onCancel={() => setAddingRoutine(false)}
          />
        )}
      </div>
    </div>
  );
}

function EditToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
        active
          ? "bg-halo text-accent"
          : "text-fg-muted hover:bg-bg-elevated hover:text-accent",
      )}
      aria-label={active ? "편집 닫기" : "편집"}
      aria-pressed={active}
    >
      {active ? <X size={12} /> : <Pencil size={12} />}
    </button>
  );
}

/** 이유 보기 — 기본 2개만, 나머지는 접는다. 세리프로 본문과 결을 다르게. */
function WhyList({ texts }: { texts: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (texts.length === 0) {
    return (
      <p className="px-2 py-3 text-center text-xs text-fg-muted">
        아직 적은 이유가 없어요.
      </p>
    );
  }
  const shown = expanded ? texts : texts.slice(0, 2);
  return (
    <div className="px-1">
      <ul className="space-y-1">
        {shown.map((t, i) => (
          <li key={`${t}-${i}`} className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold" />
            <span className="font-display text-xs leading-relaxed text-fg">
              {t}
            </span>
          </li>
        ))}
      </ul>
      {texts.length > 2 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="no-drag mt-1 text-[11px] text-fg-muted hover:text-accent"
        >
          {expanded ? "접기" : `+${texts.length - 2}개 더보기`}
        </button>
      )}
    </div>
  );
}

/** 문자열 목록 편집기(이유용). 항목별 input + 삭제 + 추가. */
function StringListEditor({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string[];
  placeholder: string;
  onSave: (v: string[]) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<string[]>(
    initial.length > 0 ? initial : [""],
  );
  return (
    <div className="no-drag flex flex-col gap-1.5 rounded-md border border-accent/30 bg-bg-elevated/70 p-2">
      {items.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={v}
            onChange={(e) =>
              setItems(items.map((x, j) => (j === i ? e.target.value : x)))
            }
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded-md border border-line bg-bg/60 px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-accent/60"
          />
          <button
            type="button"
            onClick={() => setItems(items.filter((_, j) => j !== i))}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted hover:text-rose"
            aria-label="삭제"
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setItems([...items, ""])}
        className="flex items-center gap-1 self-start rounded px-1 py-0.5 text-[11px] text-fg-muted hover:text-accent"
      >
        <Plus size={11} /> {placeholder} 추가
      </button>
      <EditorActions
        onCancel={onCancel}
        onSave={() => void onSave(items.map((s) => s.trim()).filter(Boolean))}
      />
    </div>
  );
}

/** 이정표 편집기. 순서에 의미가 있어 위/아래 이동이 필요하다. */
function MilestoneEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: { id: number | null; title: string }[];
  onSave: (v: { id: number | null; title: string }[]) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [items, setItems] = useState(initial);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    setItems(next);
  };

  return (
    <div className="no-drag flex flex-col gap-1.5 rounded-md border border-accent/30 bg-bg-elevated/70 p-2">
      {items.map((m, i) => (
        <div key={m.id ?? `new-${i}`} className="flex items-center gap-1.5">
          <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-fg-muted">
            {i + 1}
          </span>
          <input
            type="text"
            value={m.title}
            onChange={(e) =>
              setItems(
                items.map((x, j) =>
                  j === i ? { ...x, title: e.target.value } : x,
                ),
              )
            }
            placeholder="이정표"
            className="min-w-0 flex-1 rounded-md border border-line bg-bg/60 px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-accent/60"
          />
          <button
            type="button"
            onClick={() => move(i, i - 1)}
            disabled={i === 0}
            className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-fg-muted hover:text-accent disabled:opacity-30"
            aria-label="위로"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => move(i, i + 1)}
            disabled={i === items.length - 1}
            className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-fg-muted hover:text-accent disabled:opacity-30"
            aria-label="아래로"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => setItems(items.filter((_, j) => j !== i))}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted hover:text-rose"
            aria-label="삭제"
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setItems([...items, { id: null, title: "" }])}
        className="flex items-center gap-1 self-start rounded px-1 py-0.5 text-[11px] text-fg-muted hover:text-accent"
      >
        <Plus size={11} /> 새 이정표 추가
      </button>
      <EditorActions
        onCancel={onCancel}
        onSave={() =>
          void onSave(
            items
              .map((m) => ({ ...m, title: m.title.trim() }))
              .filter((m) => m.title.length > 0),
          )
        }
      />
    </div>
  );
}

function EditorActions({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-0.5 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-2 py-1 text-xs text-fg-muted hover:text-fg"
      >
        취소
      </button>
      <button
        type="button"
        onClick={onSave}
        className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg"
      >
        <Check size={11} /> 저장
      </button>
    </div>
  );
}
