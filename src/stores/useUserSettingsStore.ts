import { create } from "zustand";

import { api } from "../lib/tauri";

export const TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

const VOICE_KEY = "tts.voice";
const AUTO_PLAY_KEY = "tts.auto_play_briefing";
const MIC_KEY = "mic.device_id";

const DEFAULT_VOICE: TtsVoice = "alloy";

interface UserSettingsStore {
  voice: TtsVoice;
  autoPlayBriefing: boolean;
  micDeviceId: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  setVoice: (v: TtsVoice) => Promise<void>;
  setAutoPlayBriefing: (b: boolean) => Promise<void>;
  setMicDeviceId: (id: string | null) => Promise<void>;
}

export const useUserSettingsStore = create<UserSettingsStore>((set) => ({
  voice: DEFAULT_VOICE,
  autoPlayBriefing: true,
  micDeviceId: null,
  loaded: false,

  load: async () => {
    try {
      const [voice, auto, mic] = await Promise.all([
        api.settingsGet(VOICE_KEY),
        api.settingsGet(AUTO_PLAY_KEY),
        api.settingsGet(MIC_KEY),
      ]);
      const v = (TTS_VOICES as readonly string[]).includes(voice ?? "")
        ? (voice as TtsVoice)
        : DEFAULT_VOICE;
      set({
        voice: v,
        autoPlayBriefing: auto !== "false",
        micDeviceId: mic && mic.length > 0 ? mic : null,
        loaded: true,
      });
    } catch (e) {
      console.error("[pa] settings load failed", e);
      set({ loaded: true });
    }
  },

  setVoice: async (v) => {
    set({ voice: v });
    await api.settingsSet(VOICE_KEY, v);
  },

  setAutoPlayBriefing: async (b) => {
    set({ autoPlayBriefing: b });
    await api.settingsSet(AUTO_PLAY_KEY, b ? "true" : "false");
  },

  setMicDeviceId: async (id) => {
    set({ micDeviceId: id });
    await api.settingsSet(MIC_KEY, id ?? "");
  },
}));
