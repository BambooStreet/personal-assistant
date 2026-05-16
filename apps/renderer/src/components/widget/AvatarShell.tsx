import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Avatar } from "../avatar/Avatar";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useUiStore } from "../../stores/useUiStore";

// 클릭 vs 드래그 분리: 평소엔 click → 패널 토글. mousedown을 500ms 이상 유지하면
// dragMode 진입 → 아바타가 흔들리고 -webkit-app-region: drag가 켜진다.
// dragMode에 들어가도 OS native drag는 이번 mousedown에 소급 적용되지 않으므로
// (mousedown 시점에 drag region이 있어야 OS가 잡음), 사용자는 손을 떼고 다시 눌러서 드래그한다.
// 흔들림이 그 "이제 드래그 가능" 시그널.

const DRAG_STYLE = { WebkitAppRegion: "drag", cursor: "grab" } as CSSProperties;

const ARMING_DELAY_MS = 200; // 사용자가 누른 게 의도된 길게-누르기인지 알 수 있는 최소 시간
const DRAG_MODE_DELAY_MS = 500; // 이 시점에 dragMode 진입
const DRAG_MODE_SAFETY_MS = 5000; // 진입 후 아무것도 안 하면 자동 해제
const DRAG_MODE_GRACE_MS = 1500; // 마지막 move 이후 이 만큼 지나면 해제

const BASE = import.meta.env.BASE_URL;
const DRAGGING_SRC = `${BASE}avatar/dragging.png`;

type PressState = "idle" | "arming" | "dragMode";

export function AvatarShell() {
  const avatarState = useUiStore((s) => s.avatarState);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const [pressState, setPressState] = useState<PressState>("idle");

  const armingTimerRef = useRef<number | null>(null);
  const dragModeTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  // dragMode 진입 시 같은 mousedown의 click을 1회 막기 위한 플래그.
  const suppressClickRef = useRef(false);
  // avatar.moved 리스너가 최신 pressState를 보도록 ref로 우회.
  const pressStateRef = useRef<PressState>(pressState);
  useEffect(() => {
    pressStateRef.current = pressState;
  }, [pressState]);

  const clearPressTimers = () => {
    if (armingTimerRef.current !== null) {
      clearTimeout(armingTimerRef.current);
      armingTimerRef.current = null;
    }
    if (dragModeTimerRef.current !== null) {
      clearTimeout(dragModeTimerRef.current);
      dragModeTimerRef.current = null;
    }
  };

  const scheduleExit = (ms: number) => {
    if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      setPressState("idle");
      exitTimerRef.current = null;
    }, ms);
  };

  const handleMouseDown = () => {
    if (pressStateRef.current === "dragMode") return; // OS가 처리
    armingTimerRef.current = window.setTimeout(() => {
      setPressState("arming");
      armingTimerRef.current = null;
    }, ARMING_DELAY_MS);
    dragModeTimerRef.current = window.setTimeout(() => {
      setPressState("dragMode");
      suppressClickRef.current = true;
      dragModeTimerRef.current = null;
    }, DRAG_MODE_DELAY_MS);
  };

  const handleMouseUp = () => {
    clearPressTimers();
    if (pressStateRef.current === "arming") {
      setPressState("idle");
    } else if (pressStateRef.current === "dragMode") {
      // 손 떼는 순간부터 5초 safety 시작. 사용자가 다시 눌러서 드래그하면 avatar.moved가
      // 도착하면서 grace로 리셋된다.
      scheduleExit(DRAG_MODE_SAFETY_MS);
    }
  };

  const handleMouseLeave = () => {
    // dragMode 진입 전이면 long-press 취소.
    if (pressStateRef.current !== "dragMode") {
      clearPressTimers();
      if (pressStateRef.current === "arming") setPressState("idle");
    }
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (pressStateRef.current !== "idle") return;
    void api.windowSetPanelOpen(!panelOpen);
  };

  // OS native drag로 아바타 윈도우가 움직이면 Main이 avatar.moved를 broadcast.
  // dragMode 중이면 grace로 exit timer를 미룬다 → 드래그 멈춘 후 1.5초 뒤 자동 해제.
  useEffect(() => {
    const off = api.on("avatar.moved", () => {
      if (pressStateRef.current === "dragMode") {
        scheduleExit(DRAG_MODE_GRACE_MS);
      }
    });
    return () => off();
  }, []);

  useEffect(
    () => () => {
      clearPressTimers();
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    },
    [],
  );

  const isDrag = pressState === "dragMode";
  const isArming = pressState === "arming";

  return (
    <div className="relative h-full w-full">
      <div
        className="absolute bottom-0 left-0 z-10 flex h-[200px] w-[200px] items-center justify-center"
        style={isDrag ? DRAG_STYLE : undefined}
      >
        <button
          type="button"
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          data-clickable={isDrag ? undefined : "true"}
          className={cn(
            "flex h-[140px] w-[140px] items-center justify-center rounded-full bg-transparent p-0 select-none focus:outline-none focus-visible:outline-none",
            !isDrag && !isArming && "cursor-pointer transition-transform duration-150 ease-out hover:scale-105",
            isArming && "animate-avatar-arming cursor-pointer",
            isDrag && "cursor-grab",
          )}
          aria-label={isDrag ? "윈도우 드래그" : "패널 열기"}
        >
          {isDrag ? (
            // 흔들림은 img에만. 버튼(=drag region descendant)이 transform되면 Win11
            // transparent + frameless 컴포지터가 native drag 중 ghost frame을 만든다.
            <img
              src={DRAGGING_SRC}
              alt=""
              draggable={false}
              className="h-full w-full object-contain select-none animate-avatar-shake"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Avatar state={avatarState} size={140} />
          )}
        </button>
      </div>
    </div>
  );
}
