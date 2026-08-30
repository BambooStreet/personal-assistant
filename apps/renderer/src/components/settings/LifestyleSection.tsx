import { Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";

import {
  useLifestyleStore,
  type LifestyleBlock,
} from "../../stores/useLifestyleStore";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

// 생활 프로필 설정 — 기상/취침(평일·주말)과 반복 블록(식사·취미·청소·금지시간).
// 일과 자동 배치가 이 정보로 빈 시간을 계산한다.
export function LifestyleSection() {
  const load = useLifestyleStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  const wakeWeekday = useLifestyleStore((s) => s.wakeWeekday);
  const sleepWeekday = useLifestyleStore((s) => s.sleepWeekday);
  const wakeWeekend = useLifestyleStore((s) => s.wakeWeekend);
  const sleepWeekend = useLifestyleStore((s) => s.sleepWeekend);
  const setWakeWeekday = useLifestyleStore((s) => s.setWakeWeekday);
  const setSleepWeekday = useLifestyleStore((s) => s.setSleepWeekday);
  const setWakeWeekend = useLifestyleStore((s) => s.setWakeWeekend);
  const setSleepWeekend = useLifestyleStore((s) => s.setSleepWeekend);

  const blocks = useLifestyleStore((s) => s.blocks);
  const setBlocks = useLifestyleStore((s) => s.setBlocks);

  const updateBlock = (i: number, partial: Partial<LifestyleBlock>) => {
    void setBlocks(blocks.map((b, idx) => (idx === i ? { ...b, ...partial } : b)));
  };
  const toggleDay = (i: number, day: number) => {
    const b = blocks[i];
    const days = b.days.includes(day)
      ? b.days.filter((d) => d !== day)
      : [...b.days, day].sort((a, c) => a - c);
    updateBlock(i, { days });
  };
  const addBlock = () => {
    void setBlocks([
      ...blocks,
      { label: "", days: [0, 1, 2, 3, 4], start: "12:00", end: "13:00" },
    ]);
  };
  const removeBlock = (i: number) => {
    void setBlocks(blocks.filter((_, idx) => idx !== i));
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 기상/취침 */}
      <section className="rounded-md border border-line bg-bg-elevated/60 p-2.5">
        <p className="mb-1.5 font-display text-sm tracking-[0.02em]">기상 / 취침</p>
        <p className="mb-2 text-xs leading-relaxed text-fg-subtle">
          하루 중 일정을 배치할 수 있는 시간 범위입니다. 이 밖에는 일과를 추천하지 않습니다.
        </p>
        <div className="space-y-2">
          <TimeRangeRow
            label="평일"
            start={wakeWeekday}
            end={sleepWeekday}
            onStart={(v) => void setWakeWeekday(v)}
            onEnd={(v) => void setSleepWeekday(v)}
          />
          <TimeRangeRow
            label="주말"
            start={wakeWeekend}
            end={sleepWeekend}
            onStart={(v) => void setWakeWeekend(v)}
            onEnd={(v) => void setSleepWeekend(v)}
          />
        </div>
      </section>

      {/* 반복 블록 */}
      <section className="rounded-md border border-line bg-bg-elevated/60 p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="font-display text-sm tracking-[0.02em]">반복 블록</p>
          <button
            type="button"
            onClick={addBlock}
            className="no-drag flex items-center gap-1 rounded-md bg-accent/80 px-2 py-0.5 text-xs font-medium text-bg"
          >
            <Plus size={12} /> 추가
          </button>
        </div>
        <p className="mb-2 text-xs leading-relaxed text-fg-subtle">
          식사·운동·청소처럼 매주 반복되는 시간이나 "일정 잡지 말 시간"을 등록하세요. 이 시간은
          비는 시간에서 제외됩니다.
        </p>

        {blocks.length === 0 ? (
          <p className="py-2 text-center text-xs text-fg-subtle">
            등록된 블록이 없습니다.
          </p>
        ) : (
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <div
                key={i}
                className="space-y-1.5 rounded-md border border-line bg-bg/40 p-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={b.label}
                    onChange={(e) => updateBlock(i, { label: e.target.value })}
                    placeholder="예: 점심, 운동, 가족 시간"
                    className="no-drag flex-1 rounded-md border border-line bg-bg/60 px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
                  />
                  <button
                    type="button"
                    onClick={() => removeBlock(i)}
                    className="no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-red-500/20 hover:text-red-300"
                    aria-label="삭제"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {DAY_LABELS.map((d, day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(i, day)}
                      className={`no-drag h-6 w-6 rounded-md text-xs transition-colors ${
                        b.days.includes(day)
                          ? "bg-accent/80 text-bg"
                          : "border border-line text-fg-muted hover:text-fg"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="time"
                    value={b.start}
                    onChange={(e) => updateBlock(i, { start: e.target.value })}
                    className="no-drag rounded-md border border-line bg-bg/60 px-1.5 py-0.5 text-xs outline-none focus:border-accent/60"
                  />
                  <span>~</span>
                  <input
                    type="time"
                    value={b.end}
                    onChange={(e) => updateBlock(i, { end: e.target.value })}
                    className="no-drag rounded-md border border-line bg-bg/60 px-1.5 py-0.5 text-xs outline-none focus:border-accent/60"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TimeRangeRow({
  label,
  start,
  end,
  onStart,
  onEnd,
}: {
  label: string;
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <span className="w-8 shrink-0">{label}</span>
      <input
        type="time"
        value={start}
        onChange={(e) => onStart(e.target.value)}
        className="no-drag rounded-md border border-line bg-bg/60 px-1.5 py-0.5 text-xs outline-none focus:border-accent/60"
      />
      <span>기상 ~</span>
      <input
        type="time"
        value={end}
        onChange={(e) => onEnd(e.target.value)}
        className="no-drag rounded-md border border-line bg-bg/60 px-1.5 py-0.5 text-xs outline-none focus:border-accent/60"
      />
      <span>취침</span>
    </div>
  );
}
