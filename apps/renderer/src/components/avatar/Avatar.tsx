import { cn } from "../../lib/cn";
import type { AvatarState } from "../../stores/useUiStore";

const STATES: AvatarState[] = [
  "idle",
  "attentive",
  "listening",
  "thinking",
  "speaking",
];

// attentive 전용 PNG가 따로 없으면 idle.png를 그대로 보여주고 ring effect로 차별화.
const SOURCES: Record<AvatarState, string> = {
  idle: "/avatar/idle.png",
  attentive: "/avatar/idle.png",
  listening: "/avatar/listening.png",
  thinking: "/avatar/thinking.png",
  speaking: "/avatar/speaking.png",
};

const FALLBACK_HUE: Record<AvatarState, string> = {
  idle: "from-slate-700 to-slate-900",
  attentive: "from-amber-600 to-amber-800",
  listening: "from-sky-700 to-sky-900",
  thinking: "from-violet-700 to-violet-900",
  speaking: "from-emerald-700 to-emerald-900",
};

interface AvatarProps {
  state: AvatarState;
  size?: number;
  className?: string;
}

// 4개 PNG를 stacked로 두고 active 상태만 opacity:1, 나머지는 0.
// 상태 전환 시 200ms 크로스페이드. PNG가 없으면 fallback 그라디언트가 자연스럽게 비춰짐.
export function Avatar({ state, size = 96, className }: AvatarProps) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center transition-transform duration-150",
        "animate-avatar-float", // idle 호흡감
        className,
      )}
      style={{ width: size, height: size }}
      aria-label={`avatar-${state}`}
    >
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-full bg-gradient-to-br shadow-lg ring-1 ring-white/5",
          FALLBACK_HUE[state],
        )}
      >
        {STATES.map((s) => (
          <img
            key={s}
            src={SOURCES[s]}
            alt=""
            draggable={false}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ease-out select-none",
              s === state ? "opacity-100" : "opacity-0",
            )}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ))}
      </div>

      <StateEffect state={state} />
    </div>
  );
}

// 상태별 시각 강조: ring 색·애니메이션. 위 image stack 위에 겹쳐 그린다.
function StateEffect({ state }: { state: AvatarState }) {
  if (state === "idle") return null;

  if (state === "attentive") {
    // 한 박자 들뜬 느낌: 노란 단발 glow, 호 회전 없음
    return (
      <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-amber-300/80 animate-ring-pulse-soft" />
    );
  }

  if (state === "listening") {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-sky-400/70 animate-ring-pulse-soft" />
        <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-sky-400/40 animate-wave-out" />
        <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-sky-400/40 animate-wave-out-delay" />
      </>
    );
  }

  if (state === "thinking") {
    return (
      <div className="pointer-events-none absolute inset-0 rounded-full">
        {/* 회전하는 conic gradient ring으로 처리 중 표현 */}
        <div
          className="absolute inset-[-2px] rounded-full opacity-70"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0%, transparent 60%, rgba(167,139,250,0.9) 90%, transparent 100%)",
            animation: "spin 2s linear infinite",
            mask: "radial-gradient(circle, transparent 65%, black 67%)",
            WebkitMask: "radial-gradient(circle, transparent 65%, black 67%)",
          }}
        />
      </div>
    );
  }

  // speaking — 음파처럼 ring이 밖으로 expand
  return (
    <>
      <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-emerald-400/70 animate-ring-pulse-soft" />
      <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-emerald-400/50 animate-wave-out" />
      <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-emerald-400/50 animate-wave-out-delay" />
    </>
  );
}
