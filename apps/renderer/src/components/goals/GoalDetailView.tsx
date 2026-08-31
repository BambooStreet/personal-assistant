import { ChevronLeft, Pencil, Plus, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import type { GoalDetail } from "../../lib/api";
import { useGoalStore } from "../../stores/useGoalStore";
import { useTodoStore } from "../../stores/useTodoStore";

import { TaskForm } from "../todos/TaskForm";

import { AscentPath } from "./AscentPath";
import { ProgressBar } from "./ProgressBar";

interface Props {
  goal: GoalDetail;
  onBack: () => void;
  onEditGoal: () => void;
}

/** 한 번에 한 섹션만 편집한다 — 두 곳을 동시에 고치면 저장 순서가 꼬인다. */
type EditSection = null | "why" | "milestone" | "routine";

/**
 * 목표 상세. 섹션 순서는 고정이다: 이유 → 이정표 → 꾸준한 노력.
 * "왜 하는지"를 먼저 보고 "어디까지 왔는지"를 본 다음 "오늘 뭘 하는지"로 내려온다.
 *
 * 편집은 섹션 헤더의 기어로 열고 닫으며, **닫을 때 저장한다**. 시안에 저장 버튼이 없어서
 * 그 결을 따랐다 — 대신 편집을 열어둔 채 다른 탭으로 나가면 그 편집은 버려진다.
 */
export function GoalDetailView({ goal, onBack, onEditGoal }: Props) {
  const update = useGoalStore((s) => s.update);
  const toggleMilestone = useGoalStore((s) => s.toggleMilestone);
  const [editing, setEditing] = useState<EditSection>(null);

  const [whyRows, setWhyRows] = useState<string[]>([]);
  const [msRows, setMsRows] = useState<{ id: number | null; title: string }[]>(
    [],
  );

  const openWhy = () => {
    setWhyRows(goal.whys.map((w) => w.text));
    setEditing("why");
  };
  const openMs = () => {
    setMsRows(goal.milestones.map((m) => ({ id: m.id, title: m.title })));
    setEditing("milestone");
  };

  // 편집 중인 섹션만 draft를 바꾸고 나머지는 현재 값을 그대로 되돌려 보낸다.
  const closeAndSave = async () => {
    if (editing === "why") {
      await update(goal.id, {
        title: goal.title,
        target_ym: goal.target_ym,
        whys: whyRows.map((t) => t.trim()).filter(Boolean),
        milestones: goal.milestones.map((m) => ({ id: m.id, title: m.title })),
      });
    } else if (editing === "milestone") {
      await update(goal.id, {
        title: goal.title,
        target_ym: goal.target_ym,
        whys: goal.whys.map((w) => w.text),
        milestones: msRows
          .map((m) => ({ ...m, title: m.title.trim() }))
          .filter((m) => m.title.length > 0),
      });
    }
    setEditing(null);
  };

  return (
    <div className="panel-scroll h-full py-3 pl-3.5 pr-1.5 text-xs">
      <button
        type="button"
        onClick={onBack}
        className="no-drag mb-3 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-accent"
      >
        <ChevronLeft size={13} /> 목표 목록
      </button>

      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[21px] font-bold leading-tight tracking-[-0.01em] text-fg">
          {goal.title}
        </p>
        {/* 시안엔 목표명·시점을 고칠 진입점이 없다. 기능을 없앨 순 없어 연필을 남겼다. */}
        <button
          type="button"
          onClick={onEditGoal}
          className="no-drag mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-elevated hover:text-fg"
          aria-label="목표 수정"
        >
          <Pencil size={13} />
        </button>
      </div>
      {goal.target_ym && (
        <p className="mt-1 text-xs text-fg-muted">
          목표 시점 {goal.target_ym}
        </p>
      )}

      {/* ① 이유 */}
      <div className="mb-2.5 mt-5 flex items-center gap-2.5">
        <SectionLabel>목표를 이루고 싶은 이유</SectionLabel>
        <span className="h-px flex-1 bg-line" />
        <GearButton
          active={editing === "why"}
          onClick={() => (editing === "why" ? void closeAndSave() : openWhy())}
        />
      </div>
      {editing === "why" ? (
        <EditBox>
          <div className="flex flex-col gap-1.5">
            {whyRows.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="shrink-0 text-[13px] text-gold">·</span>
                <input
                  type="text"
                  value={v}
                  onChange={(e) =>
                    setWhyRows(whyRows.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  className={INPUT_CLS}
                />
                <RowDelete onClick={() => setWhyRows(whyRows.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
          <AddRow
            placeholder="새 이유 추가…"
            onAdd={(t) => setWhyRows([...whyRows, t])}
          />
        </EditBox>
      ) : (
        <WhyList texts={goal.whys.map((w) => w.text)} />
      )}

      {/* ② 이정표 — 헤어라인 자리에 진행 바가 들어간다. */}
      <div className="mb-2 mt-7 flex items-center gap-2.5">
        <SectionLabel>이정표</SectionLabel>
        <ProgressBar
          percent={goal.progress}
          animateOnMount
          className="h-1 flex-1"
        />
        <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold tabular-nums text-accent">
          {goal.progress}%
        </span>
        <GearButton
          active={editing === "milestone"}
          onClick={() =>
            editing === "milestone" ? void closeAndSave() : openMs()
          }
        />
      </div>

      {editing === "milestone" ? (
        <EditBox>
          <div className="flex flex-col gap-1.5">
            {msRows.map((m, i) => (
              <div key={m.id ?? `new-${i}`} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                  {i + 1}
                </span>
                <input
                  type="text"
                  value={m.title}
                  onChange={(e) =>
                    setMsRows(
                      msRows.map((x, j) =>
                        j === i ? { ...x, title: e.target.value } : x,
                      ),
                    )
                  }
                  className={INPUT_CLS}
                />
                <MoveButton
                  label="위로"
                  disabled={i === 0}
                  onClick={() => setMsRows(move(msRows, i, i - 1))}
                >
                  ↑
                </MoveButton>
                <MoveButton
                  label="아래로"
                  disabled={i === msRows.length - 1}
                  onClick={() => setMsRows(move(msRows, i, i + 1))}
                >
                  ↓
                </MoveButton>
                <RowDelete
                  onClick={() => setMsRows(msRows.filter((_, j) => j !== i))}
                />
              </div>
            ))}
          </div>
          <AddRow
            placeholder="새 이정표 추가…"
            onAdd={(t) => setMsRows([...msRows, { id: null, title: t }])}
          />
        </EditBox>
      ) : goal.milestones.length === 0 ? (
        <EmptyBox>아직 이정표가 없습니다 — 설정에서 추가하세요</EmptyBox>
      ) : (
        <AscentPath
          milestones={goal.milestones}
          onToggle={(id, done) => void toggleMilestone(id, done)}
        />
      )}

      {/* ③ 꾸준한 노력 — 지금은 목표에 딸린 루틴 알림(요일 + 시각)을 보여준다.
          시안은 트리거(일어나자마자/자기 전…) 기준인데 그 전환은 아직이다. */}
      <RoutineSection
        goal={goal}
        editing={editing === "routine"}
        onToggleEdit={() =>
          setEditing(editing === "routine" ? null : "routine")
        }
      />
    </div>
  );
}

const INPUT_CLS =
  "h-[34px] min-w-0 flex-1 rounded border border-line bg-bg-panel px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-gold";

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 whitespace-nowrap text-xs font-semibold tracking-[0.12em] text-fg-muted">
      {children}
    </span>
  );
}

/** 섹션 편집 토글. 시안은 연필이 아니라 톱니(설정) 아이콘이다. */
function GearButton({
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
      aria-pressed={active}
      aria-label={active ? "설정 닫기" : "설정"}
      className={cn(
        "no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded",
        active
          ? "bg-halo text-accent"
          : "text-fg-muted hover:bg-bg-elevated hover:text-fg",
      )}
    >
      <Settings2 size={13} />
    </button>
  );
}

function EditBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-drag rounded border border-gold-soft bg-bg-elevated p-3">
      {children}
    </div>
  );
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-line p-3.5 text-center text-[13px] text-fg-muted">
      {children}
    </div>
  );
}

function RowDelete({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[34px] w-6 shrink-0 items-center justify-center text-fg-muted hover:text-rose"
      aria-label="삭제"
    >
      <X size={11} />
    </button>
  );
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-[34px] w-6 shrink-0 items-center justify-center rounded border border-line text-xs text-fg-muted hover:border-gold hover:text-fg disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** "새 … 추가…" 입력 + 추가 버튼. 엔터로도 추가된다. */
function AddRow({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const add = () => {
    const t = value.trim();
    if (!t) return;
    onAdd(t);
    setValue("");
  };
  return (
    <div className="mt-2.5 flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        placeholder={placeholder}
        className={INPUT_CLS}
      />
      <button
        type="button"
        onClick={add}
        disabled={!value.trim()}
        className="h-[34px] shrink-0 rounded bg-accent px-3.5 text-[13px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-40"
      >
        추가
      </button>
    </div>
  );
}

/** 이유 보기 — 세리프 + 골드 점 불릿. 기본 2개만 보이고 나머지는 접는다. */
function WhyList({ texts }: { texts: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (texts.length === 0) {
    return <EmptyBox>아직 적어둔 이유가 없습니다 — 설정에서 추가하세요</EmptyBox>;
  }
  const shown = expanded ? texts : texts.slice(0, 2);
  return (
    <div className="px-0.5">
      {shown.map((t, i) => (
        <div
          key={`${t}-${i}`}
          className="flex gap-2 text-[13.5px] leading-[1.7] text-fg-muted"
        >
          <span className="shrink-0 text-[15px] leading-[1.5] text-gold">·</span>
          <span className="min-w-0">{t}</span>
        </div>
      ))}
      {texts.length > 2 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="no-drag mt-1.5 text-xs text-fg-muted underline underline-offset-[3px] hover:text-accent"
        >
          {expanded ? "접기" : `+${texts.length - 2}개 더보기`}
        </button>
      )}
    </div>
  );
}

/**
 * "꾸준한 노력" — 이 목표에 연결된 **할 일**을 보여준다. 할 일 탭과 같은 데이터의 다른
 * 뷰라서 여기서 체크하면 그쪽도 같이 바뀐다.
 *
 * 그 아래 "알림"은 별개다 — `goal_routines`(요일 비트마스크 + 시각 한 점)로 OS 알림을
 * 쏘는 기존 기능이다. 시안은 이 둘을 트리거 하나로 합치는 그림인데, 그건 배포된 알림
 * 모델을 바꾸는 별도 작업이라 지금은 나란히 둔다.
 */
function RoutineSection({
  goal,
  editing,
  onToggleEdit,
}: {
  goal: GoalDetail;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  const removeRoutine = useGoalStore((s) => s.removeRoutine);
  const todos = useTodoStore((s) => s.todos);
  const createTodo = useTodoStore((s) => s.create);
  const goals = useGoalStore((s) => s.goals).map((g) => ({
    id: g.id,
    title: g.title,
  }));
  const [addingTodo, setAddingTodo] = useState(false);
  const refreshTodos = useTodoStore((s) => s.refresh);
  const toggleTodo = useTodoStore((s) => s.toggle);
  const linkGoal = useTodoStore((s) => s.linkGoal);

  // 목표 화면에서 바로 들어와도 할 일이 비어 있지 않게.
  useEffect(() => {
    refreshTodos(true);
  }, [refreshTodos]);

  const linked = todos.filter((t) => t.goal_id === goal.id);
  // 연결 후보 = 아직 이 목표에 안 붙은 반복 할 일. 다른 목표에 붙은 것도 옮길 수 있다.
  const candidates = todos.filter((t) => !!t.recur && t.goal_id !== goal.id);

  return (
    <div className="mt-7">
      <div className="mb-2 flex items-center gap-2.5">
        <SectionLabel>꾸준한 노력</SectionLabel>
        <span className="h-px flex-1 bg-line" />
        <GearButton active={editing} onClick={onToggleEdit} />
      </div>

      {linked.length === 0 && !editing ? (
        <EmptyBox>연결된 할 일이 없습니다 — 설정에서 연결하세요</EmptyBox>
      ) : (
        <ul className="divide-y divide-line">
          {linked.map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 py-2.5">
              <button
                type="button"
                onClick={() => void toggleTodo(t.id, !t.done)}
                aria-pressed={t.done}
                aria-label={t.done ? "완료 해제" : "완료"}
                className={cn(
                  "no-drag flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                  t.done ? "border-sage bg-sage" : "border-line bg-bg-panel",
                )}
              >
                {t.done && (
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
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px] text-fg",
                  t.done && "text-fg-muted line-through",
                )}
              >
                {t.title}
              </span>
              {t.trigger_slot && (
                <span className="shrink-0 whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[10.5px] text-teal">
                  {t.trigger_slot}
                </span>
              )}
              {editing && (
                <RowDelete onClick={() => void linkGoal(t.id, null)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="mt-2.5 rounded border border-gold-soft bg-bg-elevated p-3">
          <p className="mb-2 text-[11px] tracking-[0.04em] text-fg-muted">
            할 일 추가
          </p>
          {addingTodo ? (
            <TaskForm
              goals={goals}
              defaultGoalId={goal.id}
              embedded
              onSave={async (draft) => {
                await createTodo(draft);
                setAddingTodo(false);
              }}
              onCancel={() => setAddingTodo(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingTodo(true)}
              className="no-drag flex w-full items-center gap-2 rounded border border-dashed border-line px-3 py-2 text-xs text-fg-muted hover:border-gold hover:text-accent"
            >
              <span className="text-[15px] leading-none text-gold">+</span>
              새 할 일 추가
            </button>
          )}

          <p className="mb-2 mt-3.5 text-[11px] tracking-[0.04em] text-fg-muted">
            기존 할 일 연결
          </p>
          {candidates.length === 0 ? (
            <p className="py-1 text-xs text-fg-muted">
              연결할 반복 할 일이 없어요.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {candidates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void linkGoal(t.id, goal.id)}
                    className="no-drag flex w-full items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-bg-panel"
                  >
                    <Plus size={12} className="shrink-0 text-gold" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                      {t.title}
                    </span>
                    {t.trigger_slot && (
                      <span className="shrink-0 text-[10.5px] text-fg-muted">
                        {t.trigger_slot}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 알림(요일 + 시각)은 이 섹션의 관심사가 아니라 추가 UI를 뺐다. 다만 이미 걸어둔
              알림을 끌 방법은 남겨야 한다 — 트리거 전환 때 통째로 정리한다. */}
          {goal.routines.length > 0 && (
            <div className="mt-3.5 border-t border-line pt-3">
              <p className="mb-2 text-[11px] tracking-[0.04em] text-fg-muted">
                기존 알림 (요일 + 시각)
              </p>
              <ul className="divide-y divide-line">
                {goal.routines.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 py-1.5 text-[13px] text-fg"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {r.days_label}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-teal">
                      {r.time_hhmm}
                    </span>
                    <RowDelete onClick={() => void removeRoutine(r.id)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 보기 모드에서도 알림이 있으면 알려준다 — 설정을 열어야만 보이면 잊는다. */}
      {!editing && goal.routines.length > 0 && (
        <p className="mt-2 text-[11px] text-fg-muted">
          알림 {goal.routines.map((r) => `${r.days_label} ${r.time_hhmm}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
