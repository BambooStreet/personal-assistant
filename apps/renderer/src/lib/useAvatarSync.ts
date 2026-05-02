import { useEffect } from "react";

import paApi from "./api";
import { useUiStore, type AvatarState } from "../stores/useUiStore";

const VALID: readonly AvatarState[] = [
  "idle",
  "attentive",
  "listening",
  "thinking",
  "speaking",
];

// 다른 윈도우의 setAvatarState로 인한 Main broadcast를 받아 자기 store에 반영.
// 자기 자신의 setAvatarState 호출도 broadcast → 자기에게 echo로 다시 옴 → setAvatarState 재호출.
// 동일 값이면 zustand가 ref-equality로 re-render를 방지하므로 무한루프는 아님. 그래도
// 무의미한 echo IPC를 줄이려면 echo 검사 가능하지만 1.0에서는 단순성 우선.
export function useAvatarSync(): void {
  useEffect(() => {
    const off = paApi.on("avatar.stateChanged", (data) => {
      const next = (data as { state?: unknown })?.state;
      if (typeof next !== "string") return;
      if (!(VALID as readonly string[]).includes(next)) return;
      // store에 직접 set(IPC 다시 fire하지 않도록 setAvatarState 우회).
      useUiStore.setState({ avatarState: next as AvatarState });
    });
    return () => off();
  }, []);
}
