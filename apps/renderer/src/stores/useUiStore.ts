import { create } from "zustand";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";
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

  setAvatarState: (s) => set({ avatarState: s }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setMainTab: (t) => set({ mainTab: t }),
  setSettingsTab: (t) => set({ settingsTab: t }),
}));
