import { cn } from "../../lib/cn";
import type { GoalMilestone } from "../../lib/api";

interface Props {
  milestones: GoalMilestone[];
  onToggle: (id: number, done: boolean) => void;
}

/**
 * 이정표를 "올라가는 산길" 위의 노드로 그린다. 좌하단에서 우상단으로.
 *
 * 좌표는 디자이너 핸드오프의 계산을 그대로 쓴다 — viewBox `0 0 100 H` +
 * `preserveAspectRatio="none"`이라 x는 곧 퍼센트다. 가로로 늘어나도 선 굵기가
 * 유지되도록 모든 path에 `vector-effect="non-scaling-stroke"`를 건다.
 *
 * ⚠️ 선 그리기 애니메이션(dasharray + pathLength)은 쓰지 않는다 — non-scaling-stroke와
 * 충돌해 선이 중간에 끊긴다(핸드오프의 경고).
 *
 * 노드와 라벨은 SVG가 아니라 퍼센트로 절대배치한 HTML이다. `preserveAspectRatio="none"`
 * 아래에서 SVG 도형은 가로로 찌그러지고, 한글 라벨의 알약 배경·취소선도 SVG로는 계산이
 * 번거롭다.
 */
export function AscentPath({ milestones, onToggle }: Props) {
  const n = milestones.length;
  const height = Math.max(190, 46 * n + 66);
  const yTop = 30;
  const yBot = height - 56;

  const xs = milestones.map((_, i) => (n === 1 ? 50 : 8 + (84 * i) / (n - 1)));
  const ys = milestones.map((_, i) =>
    n === 1 ? yBot : yBot - (yBot - yTop) * (i / (n - 1)),
  );

  // 세그먼트의 실선/점선은 **시작 노드의 달성 여부**로 가른다. 앞이 달성됐으면 그 구간은
  // 지나온 길이다.
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

  // 첫 미완료 = "지금 여기".
  const activeIdx = milestones.findIndex((m) => !m.done);

  return (
    <div className="relative my-1.5" style={{ height }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 overflow-visible"
        aria-hidden="true"
      >
        {areaD && <path d={areaD} className="fill-halo" opacity={0.3} />}
        {segments.map((s, i) =>
          s.done ? (
            <path
              key={i}
              d={s.d}
              className="stroke-gold"
              strokeWidth={1.8}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          ) : (
            <path
              key={i}
              d={s.d}
              className="stroke-line"
              strokeWidth={1.5}
              strokeDasharray="1.5 6"
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          ),
        )}
      </svg>

      {milestones.map((m, i) => {
        const isActive = i === activeIdx;
        const isFuture = !m.done && !isActive;
        return (
          <div key={m.id}>
            {/* 마지막 노드 위 골드 깃발 — 끝이 어디인지 보여준다. */}
            {i === n - 1 && (
              <span
                className="pointer-events-none absolute z-[1]"
                style={{
                  left: `${xs[i]}%`,
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
                  <path d="M3 2h8l-2.2 2.6L11 7.2H3z" className="fill-gold" />
                </svg>
              </span>
            )}

            <button
              type="button"
              onClick={() => onToggle(m.id, !m.done)}
              aria-pressed={m.done}
              aria-label={`${m.title} ${m.done ? "달성 해제" : "달성"}`}
              className={cn(
                "no-drag absolute z-[2] flex items-center justify-center rounded-full border-[1.5px] transition-all duration-300",
                m.done && "border-gold bg-gold",
                isActive && "border-gold bg-bg-panel shadow-[0_0_0_4px_rgb(var(--halo))]",
                isFuture && "border-line bg-bg-panel",
              )}
              style={{
                left: `${xs[i]}%`,
                top: ys[i],
                transform: "translate(-50%,-50%)",
                width: isActive ? 19 : 15,
                height: isActive ? 19 : 15,
              }}
            >
              {m.done && (
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
              {isActive && <span className="h-[7px] w-[7px] rounded-full bg-gold" />}
            </button>

            {/* 라벨. 첫/마지막은 패널 밖으로 나가지 않게 중앙 정렬을 비튼다. */}
            <div
              className="absolute z-[1] max-w-[44%] text-center"
              style={{
                left: `${xs[i]}%`,
                top: ys[i],
                transform: `translate(${i === 0 ? "-20%" : i === n - 1 ? "-80%" : "-50%"}, ${isActive ? "17px" : "12px"})`,
              }}
            >
              {m.done ? (
                <span className="whitespace-nowrap text-[11.5px] text-fg-muted line-through opacity-75">
                  {m.title}
                </span>
              ) : isActive ? (
                <span className="inline-block max-w-full rounded-full border border-gold bg-halo px-[11px] py-[3px]">
                  <span className="whitespace-nowrap text-xs font-bold text-fg">
                    {m.title}
                  </span>
                </span>
              ) : (
                <span className="whitespace-nowrap text-[11.5px] text-fg-muted">
                  {m.title}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
