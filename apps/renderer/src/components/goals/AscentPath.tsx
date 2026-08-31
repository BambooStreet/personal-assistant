import { Check, Flag } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import type { GoalMilestone } from "../../lib/api";

interface Props {
  milestones: GoalMilestone[];
  onToggle: (id: number, done: boolean) => void;
}

// 노드 위 여백(깃발) / 아래 여백(라벨). 곡선이 이 사이에만 그려진다.
const TOP_PAD = 30;
const BOTTOM_PAD = 56;
const X_START = 0.08;
const X_END = 0.92;

interface Node {
  x: number;
  y: number;
}

/**
 * 이정표를 "올라가는 산길" 위의 노드로 그린다. 좌하단에서 우상단으로.
 *
 * SVG는 **경로와 채움만** 그리고 노드·라벨은 절대배치한 HTML이다. SVG `<text>`로 하면
 * 한글 라벨의 nowrap·말줄임·알약 배경을 전부 손으로 계산해야 하고, 노드를 진짜 버튼으로
 * 만들 수도 없다.
 *
 * ⚠️ 선 그리기 애니메이션(dasharray + pathLength)은 쓰지 않는다 — non-scaling-stroke와
 * 충돌해 선이 중간에 끊긴다(디자이너 핸드오프의 경고).
 */
export function AscentPath({ milestones, onToggle }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // 폭을 재서 픽셀 좌표로 계산한다. viewBox를 늘려 맞추면 원이 타원이 되고
  // 글자 크기도 같이 늘어난다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = milestones.length;
  const height = Math.max(190, 46 * n + 66);
  // 첫 미완료 = "지금 여기". 전부 완료면 없다.
  const currentIdx = milestones.findIndex((m) => !m.done);
  const lastDoneIdx = currentIdx === -1 ? n - 1 : currentIdx - 1;

  const nodes: Node[] = milestones.map((_, i) => {
    if (n === 1) return { x: width / 2, y: (TOP_PAD + (height - BOTTOM_PAD)) / 2 };
    const t = i / (n - 1);
    return {
      x: width * (X_START + (X_END - X_START) * t),
      y: height - BOTTOM_PAD - (height - BOTTOM_PAD - TOP_PAD) * t,
    };
  });

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && n > 0 && (
        <>
          <svg
            className="absolute inset-0"
            width={width}
            height={height}
            aria-hidden="true"
          >
            {/* 곡선 아래 옅은 채움 — 길이 "지면 위에 있다"는 느낌을 준다. */}
            {n > 1 && (
              <path
                d={`${segmentPath(nodes, 0, n - 1)} L ${nodes[n - 1].x} ${height} L ${nodes[0].x} ${height} Z`}
                className="fill-halo/30"
              />
            )}
            {/* 지나온 구간 = 실선. */}
            {lastDoneIdx > 0 && (
              <path
                d={segmentPath(nodes, 0, lastDoneIdx)}
                className="stroke-gold"
                strokeWidth={1.5}
                fill="none"
                strokeLinecap="round"
              />
            )}
            {/* 남은 구간 = 성긴 점선. */}
            {lastDoneIdx < n - 1 && (
              <path
                d={segmentPath(nodes, Math.max(lastDoneIdx, 0), n - 1)}
                className="stroke-line"
                strokeWidth={1.5}
                strokeDasharray="1.5 6"
                fill="none"
                strokeLinecap="round"
              />
            )}
          </svg>

          {milestones.map((m, i) => {
            const isCurrent = i === currentIdx;
            const { x, y } = nodes[i];
            return (
              <div key={m.id}>
                {/* 마지막 노드 위 깃발 — 끝이 어디인지 보여준다. */}
                {i === n - 1 && (
                  <Flag
                    size={13}
                    className="absolute -translate-x-1/2 text-gold"
                    style={{ left: x, top: y - 26 }}
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  onClick={() => onToggle(m.id, !m.done)}
                  aria-pressed={m.done}
                  aria-label={`${m.title} ${m.done ? "달성 해제" : "달성"}`}
                  className={cn(
                    "no-drag absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-transform hover:scale-110",
                    m.done && "bg-gold text-bg",
                    isCurrent && "bg-accent ring-4 ring-halo",
                    !m.done && !isCurrent && "border border-line bg-bg",
                  )}
                  style={{
                    left: x,
                    top: y,
                    width: isCurrent ? 19 : m.done ? 15 : 12,
                    height: isCurrent ? 19 : m.done ? 15 : 12,
                  }}
                >
                  {m.done && <Check size={9} strokeWidth={3} />}
                </button>
                {/* 라벨. 첫/마지막은 패널 밖으로 나가지 않게 중앙 정렬을 비튼다. */}
                <span
                  className={cn(
                    "absolute block max-w-[130px] truncate whitespace-nowrap text-[11px] leading-none",
                    i === 0 && "-translate-x-[20%]",
                    i === n - 1 && "-translate-x-[80%]",
                    i !== 0 && i !== n - 1 && "-translate-x-1/2",
                    m.done && "text-fg-muted line-through",
                    isCurrent &&
                      "rounded-full bg-accent px-2 py-1 font-semibold text-accent-fg",
                    !m.done && !isCurrent && "text-fg-muted",
                  )}
                  style={{ left: x, top: y + (isCurrent ? 17 : 12) }}
                >
                  {m.title}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/** 노드 from~to를 잇는 cubic 경로. 제어점을 수평으로 둬서 계단이 아니라 언덕이 된다. */
function segmentPath(nodes: Node[], from: number, to: number): string {
  if (to <= from) return "";
  let d = `M ${nodes[from].x} ${nodes[from].y}`;
  for (let i = from; i < to; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const dx = (b.x - a.x) / 2;
    d += ` C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}
