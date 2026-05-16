import { create } from "zustand";

import { api } from "../lib/api";

export type AvatarState =
  | "idle"
  | "attentive"
  | "listening"
  | "thinking"
  | "speaking";
export type MainTab = "chat" | "settings";
export type SettingsTab = "todos" | "cost" | "api" | "voice" | "mic";

export interface CoreStatus {
  kind: "restarting" | "crashed";
  reason: string;
  attempt: number;
}

interface UiStore {
  avatarState: AvatarState;
  panelOpen: boolean;
  mainTab: MainTab;
  settingsTab: SettingsTab;
  coreStatus: CoreStatus | null;

  setAvatarState: (s: AvatarState) => void;
  setPanelOpen: (open: boolean) => void;
  setMainTab: (t: MainTab) => void;
  setSettingsTab: (t: SettingsTab) => void;
  setCoreStatus: (s: CoreStatus | null) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  avatarState: "idle",
  panelOpen: false,
  mainTab: "chat",
  settingsTab: "todos",
  coreStatus: null,

  setAvatarState: (s) => {
    set({ avatarState: s });
    // 다른 윈도우에도 즉시 broadcast (Main이 양쪽에 fan-out).
    void api.windowSetAvatarState(s);
  },
  setPanelOpen: (open) => set({ panelOpen: open }),
  setMainTab: (t) => set({ mainTab: t }),
  setSettingsTab: (t) => set({ settingsTab: t }),
  setCoreStatus: (s) => set({ coreStatus: s }),
}));
