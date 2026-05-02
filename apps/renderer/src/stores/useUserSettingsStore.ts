import { create } from "zustand";

import { api } from "../lib/runtime";

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

const DEFAULT_VOICE: TtsVoice = "alloy";

interface UserSettingsStore {
  voice: TtsVoice;
  autoPlayBriefing: boolean;
  micDeviceId: string | null;
  onboardingCompleted: boolean;
  loaded: boolean;

  load: () => Promise<void>;
  setVoice: (v: TtsVoice) => Promise<void>;
  setAutoPlayBriefing: (b: boolean) => Promise<void>;
  setMicDeviceId: (id: string | null) => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

export const useUserSettingsStore = create<UserSettingsStore>((set) => ({
  voice: DEFAULT_VOICE,
  autoPlayBriefing: true,
  micDeviceId: null,
  onboardingCompleted: false,
  loaded: false,

  load: async () => {
    try {
      const [voice, auto, mic, onboarding, secrets] = await Promise.all([
        api.settingsGet(VOICE_KEY),
        api.settingsGet(AUTO_PLAY_KEY),
        api.settingsGet(MIC_KEY),
        api.settingsGet(ONBOARDING_KEY),
        api.secretStatusAll().catch(() => []),
      ]);
      const v = (TTS_VOICES as readonly string[]).includes(voice ?? "")
        ? (voice as TtsVoice)
        : DEFAULT_VOICE;
      // 첫 실행 판정: onboarding.completed가 명시적으로 저장되어 있지 않으면 기본 false.
      // 단, 기존 사용자(이미 OpenAI 키 저장)에겐 onboarding을 띄우지 않도록 자동 완료 처리.
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
}));
