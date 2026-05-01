import { cn } from "../../lib/cn";
import type { AvatarState } from "../../stores/useUiStore";

const SOURCES: Record<AvatarState, string> = {
  idle: "/avatar/idle.png",
  listening: "/avatar/listening.png",
  thinking: "/avatar/thinking.png",
  speaking: "/avatar/speaking.png",
};

const FALLBACK_HUE: Record<AvatarState, string> = {
  idle: "from-slate-700 to-slate-900",
  listening: "from-sky-700 to-sky-900",
  thinking: "from-violet-700 to-violet-900",
  speaking: "from-emerald-700 to-emerald-900",
};

interface AvatarProps {
  state: AvatarState;
  size?: number;
  className?: string;
}

export function Avatar({ state, size = 96, className }: AvatarProps) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-full bg-gradient-to-br shadow-lg ring-1 ring-white/5",
        FALLBACK_HUE[state],
        className,
      )}
      style={{ width: size, height: size }}
      aria-label={`avatar-${state}`}
    >
      <img
        src={SOURCES[state]}
        alt=""
        className="h-full w-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full ring-2 transition-opacity",
          state === "listening"
            ? "ring-sky-400/60 animate-pulse"
            : state === "speaking"
              ? "ring-emerald-400/60 animate-pulse"
              : state === "thinking"
                ? "ring-violet-400/60"
                : "ring-transparent",
        )}
      />
    </div>
  );
}
