import { create } from "zustand";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";
export type MainTab = "chat" | "settings";
export type SettingsTab = "todos" | "cost" | "api" | "voice" | "mic";
export type PanelDirection = "top" | "bottom";
export type PanelHorizontal = "left" | "right";

interface UiStore {
  avatarState: AvatarState;
  panelOpen: boolean;
  panelDirection: PanelDirection;
  panelHorizontal: PanelHorizontal;
  mainTab: MainTab;
  settingsTab: SettingsTab;

  setAvatarState: (s: AvatarState) => void;
  setPanelOpen: (open: boolean) => void;
  setPanelDirection: (d: PanelDirection) => void;
  setPanelHorizontal: (h: PanelHorizontal) => void;
  setMainTab: (t: MainTab) => void;
  setSettingsTab: (t: SettingsTab) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  avatarState: "idle",
  panelOpen: false,
  panelDirection: "top",
  panelHorizontal: "left",
  mainTab: "chat",
  settingsTab: "todos",

  setAvatarState: (s) => set({ avatarState: s }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setPanelDirection: (d) => set({ panelDirection: d }),
  setPanelHorizontal: (h) => set({ panelHorizontal: h }),
  setMainTab: (t) => set({ mainTab: t }),
  setSettingsTab: (t) => set({ settingsTab: t }),
}));
