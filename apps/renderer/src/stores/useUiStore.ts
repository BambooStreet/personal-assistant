import { create } from "zustand";

import paApi from "../lib/api";

export type AvatarState =
  | "idle"
  | "attentive"
  | "listening"
  | "thinking"
  | "speaking";
export type MainTab = "chat" | "settings";
export type SettingsTab = "todos" | "cost" | "api" | "voice" | "mic";

interface UiStore {
  avatarState: AvatarState;
  panelOpen: boolean;
  mainTab: MainTab;
  settingsTab: SettingsTab;

  setAvatarState: (s: AvatarState) => void;
  setPanelOpen: (open: boolean) => void;
  setMainTab: (t: MainTab) => void;
  setSettingsTab: (t: SettingsTab) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  avatarState: "idle",
  panelOpen: false,
  mainTab: "chat",
  settingsTab: "todos",

  setAvatarState: (s) => {
    set({ avatarState: s });
    // 다른 윈도우에도 즉시 broadcast (Main이 양쪽에 fan-out).
    void paApi.windowSetAvatarState(s);
  },
  setPanelOpen: (open) => set({ panelOpen: open }),
  setMainTab: (t) => set({ mainTab: t }),
  setSettingsTab: (t) => set({ settingsTab: t }),
}));
