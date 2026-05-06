import { cn } from "../../lib/cn";
import type { AvatarState } from "../../stores/useUiStore";

const STATES: AvatarState[] = [
  "idle",
  "attentive",
  "listening",
  "thinking",
  "speaking",
];

// 패키징된 file:// 환경에서 절대경로(`/avatar/...`)는 디스크 루트로 해석돼 404가 난다.
// vite의 BASE_URL(`./`)을 prefix해서 현재 index.html 기준 상대경로로 해석되게 한다.
const BASE = import.meta.env.BASE_URL;
const SOURCES: Record<AvatarState, string> = {
  idle: `${BASE}avatar/idle.png`,
  attentive: `${BASE}avatar/attentive.png`,
  listening: `${BASE}avatar/listening.png`,
  thinking: `${BASE}avatar/thinking.png`,
  speaking: `${BASE}avatar/speaking.png`,
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
      <div className="relative h-full w-full">
        {STATES.map((s) => (
          <img
            key={s}
            src={SOURCES[s]}
            alt=""
            draggable={false}
            className={cn(
              "absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ease-out select-none",
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
