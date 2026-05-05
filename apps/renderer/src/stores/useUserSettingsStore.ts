import { create } from "zustand";

import { api } from "../lib/api";

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
const ONBOARDING_KEY = "onboarding.completed";
const USER_NAME_KEY = "user.name";
const VOICE_ENABLED_KEY = "voice.enabled";

const DEFAULT_VOICE: TtsVoice = "alloy";

interface UserSettingsStore {
  voice: TtsVoice;
  autoPlayBriefing: boolean;
  micDeviceId: string | null;
  onboardingCompleted: boolean;
  userName: string;
  voiceEnabled: boolean;
  loaded: boolean;

  load: () => Promise<void>;
  setVoice: (v: TtsVoice) => Promise<void>;
  setAutoPlayBriefing: (b: boolean) => Promise<void>;
  setMicDeviceId: (id: string | null) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  setUserName: (name: string) => Promise<void>;
  setVoiceEnabled: (enabled: boolean) => Promise<void>;
}

export const useUserSettingsStore = create<UserSettingsStore>((set) => ({
  voice: DEFAULT_VOICE,
  autoPlayBriefing: true,
  micDeviceId: null,
  onboardingCompleted: false,
  userName: "",
  voiceEnabled: false,
  loaded: false,

  load: async () => {
    try {
      const [voice, auto, mic, onboarding, name, voiceEnabled, secrets] =
        await Promise.all([
          api.settingsGet(VOICE_KEY),
          api.settingsGet(AUTO_PLAY_KEY),
          api.settingsGet(MIC_KEY),
          api.settingsGet(ONBOARDING_KEY),
          api.settingsGet(USER_NAME_KEY),
          api.settingsGet(VOICE_ENABLED_KEY),
          api.secretStatusAll().catch(() => []),
        ]);
      const v = (TTS_VOICES as readonly string[]).includes(voice ?? "")
        ? (voice as TtsVoice)
        : DEFAULT_VOICE;
      let onboardingCompleted = onboarding === "true";
      if (onboarding === null) {
        const hasOpenAi = secrets.some(
          (s) => s.slot === "openai.api_key" && s.is_set,
        );
        if (hasOpenAi) {
          onboardingCompleted = true;
          await api.settingsSet(ONBOARDING_KEY, "true").catch(() => {});
        }
      }
      set({
        voice: v,
        autoPlayBriefing: auto !== "false",
        micDeviceId: mic && mic.length > 0 ? mic : null,
        onboardingCompleted,
        userName: name ?? "",
        voiceEnabled: voiceEnabled === "true",
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

  completeOnboarding: async () => {
    set({ onboardingCompleted: true });
    await api.settingsSet(ONBOARDING_KEY, "true");
  },

  setUserName: async (name) => {
    const trimmed = name.trim();
    set({ userName: trimmed });
    await api.settingsSet(USER_NAME_KEY, trimmed);
  },

  setVoiceEnabled: async (enabled) => {
    set({ voiceEnabled: enabled });
    await api.settingsSet(VOICE_ENABLED_KEY, enabled ? "true" : "false");
    await api.windowBroadcast("voice.enabledChanged", { enabled });
  },
}));
