import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import type { GoalMilestone } from "../../lib/api";

interface Props {
  milestones: GoalMilestone[];
  onToggle: (id: number, done: boolean) => void;
}

// 노드 위 여백(깃발) / 아래 여백(라벨).
const Y_TOP = 30;
const Y_BOTTOM_PAD = 56;
const X_START = 8;
const X_SPAN = 84;

/**
 * 이정표를 "올라가는 산길" 위의 노드로 그린다. 좌하단에서 우상단으로.
 *
 * **좌표는 실제 픽셀이다**(폭을 재서 계산). 시안은 `viewBox 0 0 100 H` +
 * `preserveAspectRatio="none"` + `non-scaling-stroke`인데, 그 조합에서는 선을 그려 올리는
 * 애니메이션(dasharray/dashoffset)이 깨진다 — 좌표계가 가로로만 늘어나 dash 길이가
 * 뒤틀리기 때문이고, 핸드오프도 같은 이유로 그 트릭을 금지했다.
 * 픽셀 좌표로 가면 왜곡이 없어 dashoffset이 그대로 동작한다.
 *
 * 노드와 라벨은 SVG가 아니라 절대배치한 HTML이다 — 한글 라벨의 알약 배경·취소선을
 * SVG `<text>`로 계산하는 것보다 안정적이고, 노드를 진짜 버튼으로 만들 수 있다.
 */
export function AscentPath({ milestones, onToggle }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = milestones.length;
  const height = Math.max(190, 46 * n + 66);
  const yBot = height - Y_BOTTOM_PAD;

  const xs = milestones.map((_, i) =>
    n === 1 ? width / 2 : (width * (X_START + (X_SPAN * i) / (n - 1))) / 100,
  );
  const ys = milestones.map((_, i) =>
    n === 1 ? yBot : yBot - (yBot - Y_TOP) * (i / (n - 1)),
  );

  // 첫 미완료 = "지금 여기". 전부 달성했으면 -1.
  const activeIdx = milestones.findIndex((m) => !m.done);
  // 되돌릴 수 있는 것은 **마지막으로 달성한 하나**뿐이다.
  const undoableIdx = activeIdx === -1 ? n - 1 : activeIdx - 1;
  // 순서대로만 밟는다 — 중간을 건너뛰면 산길이라는 은유가 깨지고 진행률도 뜻이 흐려진다.
  const canToggle = (i: number) => i === activeIdx || i === undoableIdx;

  const segments = milestones.slice(0, -1).map((m, i) => {
    const dx = (xs[i + 1] - xs[i]) * 0.45;
    return {
      d: `M ${xs[i]} ${ys[i]} C ${xs[i] + dx} ${ys[i]}, ${xs[i + 1] - dx} ${ys[i + 1]}, ${xs[i + 1]} ${ys[i + 1]}`,
      done: m.done,
    };
  });
  const areaD =
    n > 1
      ? `M ${xs[0]} ${ys[0]}` +
        segments.map((s) => s.d.slice(s.d.indexOf(" C"))).join("") +
        ` L ${xs[n - 1]} ${height} L ${xs[0]} ${height} Z`
      : "";

  return (
    <div ref={ref} className="relative my-1.5 w-full" style={{ height }}>
      {width > 0 && (
        <>
          <svg
            width={width}
            height={height}
            className="absolute inset-0 overflow-visible"
            aria-hidden="true"
          >
            {areaD && <path d={areaD} className="fill-halo" opacity={0.3} />}
            {segments.map((s, i) =>
              s.done ? (
                // key에 상태를 섞어야 토글할 때 다시 그려진다 — 같은 key면 React가 DOM을
                // 재사용해 애니메이션이 재시작하지 않는다.
                <path
                  key={`${i}-done`}
                  d={s.d}
                  className="animate-draw-line stroke-gold"
                  strokeWidth={1.8}
                  fill="none"
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={0}
                />
              ) : (
                <path
                  key={`${i}-todo`}
                  d={s.d}
                  className="stroke-line"
                  strokeWidth={1.5}
                  strokeDasharray="1.5 6"
                  fill="none"
                  strokeLinecap="round"
                />
              ),
            )}
          </svg>

          {milestones.map((m, i) => {
            const isActive = i === activeIdx;
            const isFuture = !m.done && !isActive;
            const enabled = canToggle(i);
            return (
              <div key={m.id}>
                {i === n - 1 && (
                  <span
                    className="pointer-events-none absolute z-[1]"
                    style={{
                      left: xs[i],
                      top: ys[i] - 13,
                      transform: "translate(-90%,-100%)",
                    }}
                    aria-hidden="true"
                  >
                    <svg width="15" height="17" viewBox="0 0 14 16" fill="none">
                      <path
                        d="M3 15V1.5"
                        className="stroke-accent"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                      <path
                        d="M3 2h8l-2.2 2.6L11 7.2H3z"
                        className="fill-gold"
                      />
                    </svg>
                  </span>
                )}

                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => onToggle(m.id, !m.done)}
                  aria-pressed={m.done}
                  aria-label={`${m.title} ${m.done ? "달성 해제" : "달성"}`}
                  title={
                    enabled
                      ? m.done
                        ? "달성 해제"
                        : "달성"
                      : "앞의 이정표부터 차례로 달성해요"
                  }
                  className={cn(
                    "absolute z-[2] flex items-center justify-center rounded-full border-[1.5px] transition-all duration-300",
                    enabled ? "no-drag" : "cursor-default",
                    m.done && "border-gold bg-gold",
                    isActive &&
                      "border-gold bg-bg-panel shadow-[0_0_0_4px_rgb(var(--halo))]",
                    isFuture && "border-line bg-bg-panel",
                  )}
                  style={{
                    left: xs[i],
                    top: ys[i],
                    transform: "translate(-50%,-50%)",
                    width: isActive ? 20 : 16,
                    height: isActive ? 20 : 16,
                  }}
                >
                  {m.done && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      className="animate-check-pop"
                    >
                      <path
                        d="M2 5.2l2 2L8 3"
                        className="stroke-bg-panel"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {isActive && (
                    <span className="h-[7px] w-[7px] animate-check-pop rounded-full bg-gold" />
                  )}
                </button>

                {/* 라벨. 첫/마지막은 패널 밖으로 나가지 않게 중앙 정렬을 비튼다. */}
                <div
                  className="absolute z-[1] max-w-[44%] text-center"
                  style={{
                    left: xs[i],
                    top: ys[i],
                    transform: `translate(${i === 0 ? "-20%" : i === n - 1 ? "-80%" : "-50%"}, ${isActive ? "18px" : "13px"})`,
                  }}
                >
                  {m.done ? (
                    <span
                      key="done"
                      className="strike-in whitespace-nowrap text-[12.5px] text-fg-muted opacity-75"
                    >
                      {m.title}
                    </span>
                  ) : isActive ? (
                    <span
                      key="active"
                      className="inline-block max-w-full animate-grow-in rounded-full border border-gold bg-halo px-3 py-1"
                    >
                      <span className="whitespace-nowrap text-[13px] font-bold text-fg">
                        {m.title}
                      </span>
                    </span>
                  ) : (
                    <span
                      key="future"
                      className="whitespace-nowrap text-[12.5px] text-fg-muted"
                    >
                      {m.title}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
