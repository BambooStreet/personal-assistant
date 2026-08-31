import { Trash2, X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

import type { GoalDetail, GoalDraft } from "../../lib/api";
import { useGoalStore } from "../../stores/useGoalStore";
import { GoalDetailView } from "./GoalDetailView";
import { ProgressBar } from "./ProgressBar";

// ===== 목표 탭 =====
//
// 원래 TodoPanel 안의 접이식 섹션이었다("정해두면 거의 안 들어오는 화면"이라 기본 접힘).
// 자기 탭이 생겼으므로 접기를 없앤다 — 탭을 눌러 들어온 사람에게 한 번 더 펼치라고
// 하는 건 의미 없는 클릭이다.
export function GoalPanel() {
  const goals = useGoalStore((s) => s.goals);
  const error = useGoalStore((s) => s.error);
  const refresh = useGoalStore((s) => s.refresh);
  const create = useGoalStore((s) => s.create);
  const update = useGoalStore((s) => s.update);
  const remove = useGoalStore((s) => s.remove);

  const [adding, setAdding] = useState(false);
  // 상세 화면에 있는 목표 id. null이면 목록.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async (draft: GoalDraft) => {
    const created = await create(draft);
    if (created) {
      setAdding(false);
      // 만들자마자 상세로 — 이정표를 채우는 게 다음 할 일이다.
      setSelectedId(created.id);
    }
  };

  const onUpdate = async (id: number, draft: GoalDraft) => {
    const updated = await update(id, draft);
    if (updated) setEditingId(null);
  };

  const selected = goals.find((g) => g.id === selectedId) ?? null;

  // 상세 화면. 목표가 지워졌으면(다른 창에서) 자동으로 목록으로 돌아간다.
  if (selected) {
    if (editingId === selected.id) {
      return (
        <div className="h-full overflow-y-auto p-2 text-xs">
          <GoalForm
            goal={selected}
            onSave={(d) => onUpdate(selected.id, d)}
            onCancel={() => setEditingId(null)}
          />
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              void remove(selected.id);
              setSelectedId(null);
            }}
            className="no-drag mt-2 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-fg-muted hover:text-rose"
          >
            <Trash2 size={11} /> 이 목표 삭제
          </button>
        </div>
      );
    }
    return (
      <GoalDetailView
        goal={selected}
        onBack={() => setSelectedId(null)}
        onEditGoal={() => setEditingId(selected.id)}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto px-3.5 py-3 text-xs">
      {adding ? (
        <GoalForm onSave={onCreate} onCancel={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="no-drag mb-3 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-line py-2.5 text-xs text-fg-muted hover:border-gold hover:text-accent"
        >
          <span className="text-[15px] leading-none text-gold">+</span>
          새 목표 추가
        </button>
      )}

      {error && (
        <p className="mb-3 rounded border border-rose/40 bg-rose/10 p-2 text-xs text-rose">
          {error}
        </p>
      )}

      {goals.length === 0 && !adding ? (
        <p className="px-2 py-6 text-center text-xs text-fg-muted">
          아직 목표가 없어요.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} onOpen={() => setSelectedId(g.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 목표 카드 (목록) =====

/**
 * 안쪽 골드 헤어라인을 두른 카드. 채팅 카드·패널 껍데기와 같은 이중 프레임이라
 * 목표 하나하나가 "액자에 넣은 것"처럼 보인다.
 */
function GoalCard({ goal, onOpen }: { goal: GoalDetail; onOpen: () => void }) {
  const firstWhy = goal.whys[0]?.text;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="no-drag relative w-full rounded border border-line bg-bg-panel px-4 pb-3.5 pt-4 text-left hover:border-gold"
    >
      <span className="pointer-events-none absolute inset-[3px] rounded-[3px] border border-gold/20" />
      <span className="flex items-baseline justify-between gap-2.5">
        <span className="min-w-0 truncate text-[16.5px] font-semibold tracking-[0.03em] text-fg">
          {goal.title}
        </span>
        {goal.target_ym && (
          <span className="shrink-0 whitespace-nowrap text-[11px] text-fg-muted">
            목표 시점 {goal.target_ym}
          </span>
        )}
      </span>
      {firstWhy && (
        <span className="mt-1.5 block truncate font-display text-[11.5px] leading-[1.6] text-fg-muted">
          “{firstWhy}”
        </span>
      )}
      <span className="mt-3 flex items-center gap-2.5">
        <ProgressBar percent={goal.progress} className="h-[5px] flex-1" />
        <span className="shrink-0 text-xs font-semibold tabular-nums text-accent">
          {goal.progress}%
        </span>
      </span>
    </button>
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
  const [target, setTarget] = useState(goal?.target_ym ?? "");
  // '왜'는 여러 개 — 한 줄에 하나. 알림에서 날마다 번갈아 쓰인다.
  const [whys, setWhys] = useState(
    (goal?.whys ?? []).map((w) => w.text).join("\n"),
  );

  const save = () => {
    const t = title.trim();
    if (!t) return;
    void onSave({
      title: t,
      target_ym: target.trim() || null,
      whys: whys
        .split("\n")
        .map((w) => w.trim())
        .filter(Boolean),
      // 이정표는 이 폼에서 안 건드린다 — 상세 화면의 전용 편집기가 담당한다.
      // 빈 배열을 보내면 Core가 "전부 지웠다"로 읽으므로 그대로 되돌려 보낸다.
      milestones: (goal?.milestones ?? []).map((m) => ({
        id: m.id,
        title: m.title,
      })),
    });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    }
  };

  return (
    // 시안: 제목 / 시점(고정폭) / 저장 3열 그리드 + 그 아래 이유 한 줄.
    // 세로로 쌓으면 "목표 하나 적는다"가 폼 작성처럼 무거워진다.
    <div className="no-drag mb-3 rounded border border-gold-soft bg-bg-elevated p-3">
      <div className="grid grid-cols-[1fr_110px_auto] items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKey}
          placeholder="이루고 싶은 목표"
          className="h-8 min-w-0 rounded border border-line bg-bg-panel px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-gold"
        />
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={onKey}
          placeholder="시점 (예: 2027. 07.)"
          className="h-8 min-w-0 rounded border border-line bg-bg-panel px-2 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-gold"
        />
        <button
          type="button"
          onClick={save}
          disabled={!title.trim()}
          className="h-8 whitespace-nowrap rounded bg-accent px-3.5 text-[12.5px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-40"
        >
          저장
        </button>
      </div>
      <input
        type="text"
        value={whys}
        onChange={(e) => setWhys(e.target.value)}
        onKeyDown={onKey}
        placeholder="왜 이루고 싶나요? — 나만의 동기 (선택)"
        className="mt-2 h-8 w-full rounded border border-line bg-bg-panel px-2.5 text-[12.5px] text-fg outline-none placeholder:text-fg-muted focus:border-gold"
      />
      <button
        type="button"
        onClick={onCancel}
        className="mt-2 flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
      >
        <X size={11} /> 취소
      </button>
    </div>
  );
}
