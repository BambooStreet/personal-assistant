import { create } from "zustand";

import { api } from "../lib/api";

export type AvatarState =
  | "idle"
  | "attentive"
  | "listening"
  | "thinking"
  | "speaking";
export type MainTab = "chat" | "todos" | "cost" | "settings";
export type SettingsTab =
  | "general"
  | "voice"
  | "mic"
  | "notifications"
  | "lifestyle"
  | "connections"
  | "developer";

export interface CoreStatus {
  kind: "restarting" | "crashed";
  reason: string;
  attempt: number;
}

interface UiStore {
  avatarState: AvatarState;
  // 아바타 가시성(숨김 모드). false면 마이크/웨이크워드/TTS 연출 중단, 일정 알림(OS 토스트)만 유지.
  // 단일 소스는 Main(windows.ts) — avatar.visibilityChanged broadcast로 동기화.
  avatarVisible: boolean;
  panelOpen: boolean;
  mainTab: MainTab;
  settingsTab: SettingsTab;
  coreStatus: CoreStatus | null;

  setAvatarState: (s: AvatarState) => void;
  setAvatarVisible: (v: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setMainTab: (t: MainTab) => void;
  setSettingsTab: (t: SettingsTab) => void;
  setCoreStatus: (s: CoreStatus | null) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  avatarState: "idle",
  avatarVisible: true,
  panelOpen: false,
  mainTab: "chat",
  settingsTab: "general",
  coreStatus: null,

  setAvatarState: (s) => {
    set({ avatarState: s });
    // 다른 윈도우에도 즉시 broadcast (Main이 양쪽에 fan-out).
    void api.windowSetAvatarState(s);
  },
  // Main이 가시성 단일 소스이므로 store만 갱신(IPC echo 불필요).
  setAvatarVisible: (v) => set({ avatarVisible: v }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setMainTab: (t) => set({ mainTab: t }),
  setSettingsTab: (t) => set({ settingsTab: t }),
  setCoreStatus: (s) => set({ coreStatus: s }),
}));
