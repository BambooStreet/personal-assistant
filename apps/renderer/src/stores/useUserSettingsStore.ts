import { create } from "zustand";

import { api } from "../lib/api";

// gpt-4o-mini-tts 지원 voice. coral/sage/ballad/ash/verse는 신규 — 표현력 더 풍부.
export const TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

const VOICE_KEY = "tts.voice";
const AUTO_PLAY_KEY = "tts.auto_play_briefing";
const MIC_KEY = "mic.device_id";
const MIC_THRESHOLD_KEY = "mic.threshold_rms";
const MIC_SILENCE_KEY = "mic.silence_ms";
const MIC_INITIAL_WAIT_KEY = "mic.initial_wait_ms";
const MIC_FOLLOWUP_INITIAL_KEY = "mic.followup_initial_wait_ms";
const MIC_FOLLOWUP_MAX_KEY = "mic.followup_max_duration_ms";
const ONBOARDING_KEY = "onboarding.completed";
const USER_NAME_KEY = "user.name";
const VOICE_ENABLED_KEY = "voice.enabled";
const VOICE_FOLLOWUP_KEY = "voice.followup_enabled";
const WAKE_THRESHOLD_KEY = "wake.threshold";
const WAKE_DISPLAY_LABEL_KEY = "wake.display_label";

const DEFAULT_VOICE: TtsVoice = "coral";

export const VAD_DEFAULTS = {
  thresholdRms: 0.04,
  silenceMs: 1500,
  initialWaitMs: 6_000,
  followupInitialWaitMs: 4_000,
  followupMaxDurationMs: 15_000,
} as const;

export const WAKE_THRESHOLD_DEFAULT = 0.98;

interface UserSettingsStore {
  voice: TtsVoice;
  autoPlayBriefing: boolean;
  micDeviceId: string | null;
  micThresholdRms: number;
  micSilenceMs: number;
  micInitialWaitMs: number;
  micFollowupInitialWaitMs: number;
  micFollowupMaxDurationMs: number;
  onboardingCompleted: boolean;
  userName: string;
  voiceEnabled: boolean;
  voiceFollowupEnabled: boolean;
  wakeThreshold: number;
  wakeDisplayLabel: string;
  loaded: boolean;

  load: () => Promise<void>;
  setVoice: (v: TtsVoice) => Promise<void>;
  setAutoPlayBriefing: (b: boolean) => Promise<void>;
  setMicDeviceId: (id: string | null) => Promise<void>;
  setMicThresholdRms: (v: number) => Promise<void>;
  setMicSilenceMs: (v: number) => Promise<void>;
  setMicInitialWaitMs: (v: number) => Promise<void>;
  setMicFollowupInitialWaitMs: (v: number) => Promise<void>;
  setMicFollowupMaxDurationMs: (v: number) => Promise<void>;
  resetMicVadToDefaults: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  setUserName: (name: string) => Promise<void>;
  setVoiceEnabled: (enabled: boolean) => Promise<void>;
  setVoiceFollowupEnabled: (enabled: boolean) => Promise<void>;
  setWakeThreshold: (v: number) => Promise<void>;
  setWakeDisplayLabel: (v: string) => Promise<void>;
}

function parseFloatOr(s: string | null, fallback: number): number {
  if (!s) return fallback;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : fallback;
}

function parseIntOr(s: string | null, fallback: number): number {
  if (!s) return fallback;
  const v = parseInt(s, 10);
  return Number.isFinite(v) ? v : fallback;
}

export const useUserSettingsStore = create<UserSettingsStore>((set) => ({
  voice: DEFAULT_VOICE,
  autoPlayBriefing: true,
  micDeviceId: null,
  micThresholdRms: VAD_DEFAULTS.thresholdRms,
  micSilenceMs: VAD_DEFAULTS.silenceMs,
  micInitialWaitMs: VAD_DEFAULTS.initialWaitMs,
  micFollowupInitialWaitMs: VAD_DEFAULTS.followupInitialWaitMs,
  micFollowupMaxDurationMs: VAD_DEFAULTS.followupMaxDurationMs,
  onboardingCompleted: false,
  userName: "",
  voiceEnabled: false,
  voiceFollowupEnabled: true,
  wakeThreshold: WAKE_THRESHOLD_DEFAULT,
  wakeDisplayLabel: "",
  loaded: false,

  load: async () => {
    try {
      const [
        voice,
        auto,
        mic,
        thr,
        silence,
        initialWait,
        followupInitial,
        followupMax,
        onboarding,
        name,
        voiceEnabled,
        followupEnabled,
        wakeThr,
        wakeLabel,
        secrets,
      ] = await Promise.all([
        api.settingsGet(VOICE_KEY),
        api.settingsGet(AUTO_PLAY_KEY),
        api.settingsGet(MIC_KEY),
        api.settingsGet(MIC_THRESHOLD_KEY),
        api.settingsGet(MIC_SILENCE_KEY),
        api.settingsGet(MIC_INITIAL_WAIT_KEY),
        api.settingsGet(MIC_FOLLOWUP_INITIAL_KEY),
        api.settingsGet(MIC_FOLLOWUP_MAX_KEY),
        api.settingsGet(ONBOARDING_KEY),
        api.settingsGet(USER_NAME_KEY),
        api.settingsGet(VOICE_ENABLED_KEY),
        api.settingsGet(VOICE_FOLLOWUP_KEY),
        api.settingsGet(WAKE_THRESHOLD_KEY),
        api.settingsGet(WAKE_DISPLAY_LABEL_KEY),
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
        micThresholdRms: parseFloatOr(thr, VAD_DEFAULTS.thresholdRms),
        micSilenceMs: parseIntOr(silence, VAD_DEFAULTS.silenceMs),
        micInitialWaitMs: parseIntOr(initialWait, VAD_DEFAULTS.initialWaitMs),
        micFollowupInitialWaitMs: parseIntOr(
          followupInitial,
          VAD_DEFAULTS.followupInitialWaitMs,
        ),
        micFollowupMaxDurationMs: parseIntOr(
          followupMax,
          VAD_DEFAULTS.followupMaxDurationMs,
        ),
        onboardingCompleted,
        userName: name ?? "",
        voiceEnabled: voiceEnabled === "true",
        voiceFollowupEnabled: followupEnabled !== "false",
        wakeThreshold: parseFloatOr(wakeThr, WAKE_THRESHOLD_DEFAULT),
        wakeDisplayLabel: (wakeLabel ?? "").trim(),
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

  setMicThresholdRms: async (v) => {
    set({ micThresholdRms: v });
    await api.settingsSet(MIC_THRESHOLD_KEY, v.toString());
  },

  setMicSilenceMs: async (v) => {
    set({ micSilenceMs: v });
    await api.settingsSet(MIC_SILENCE_KEY, Math.round(v).toString());
  },

  setMicInitialWaitMs: async (v) => {
    set({ micInitialWaitMs: v });
    await api.settingsSet(MIC_INITIAL_WAIT_KEY, Math.round(v).toString());
  },

  setMicFollowupInitialWaitMs: async (v) => {
    set({ micFollowupInitialWaitMs: v });
    await api.settingsSet(
      MIC_FOLLOWUP_INITIAL_KEY,
      Math.round(v).toString(),
    );
  },

  setMicFollowupMaxDurationMs: async (v) => {
    set({ micFollowupMaxDurationMs: v });
    await api.settingsSet(MIC_FOLLOWUP_MAX_KEY, Math.round(v).toString());
  },

  resetMicVadToDefaults: async () => {
    set({
      micThresholdRms: VAD_DEFAULTS.thresholdRms,
      micSilenceMs: VAD_DEFAULTS.silenceMs,
      micInitialWaitMs: VAD_DEFAULTS.initialWaitMs,
      micFollowupInitialWaitMs: VAD_DEFAULTS.followupInitialWaitMs,
      micFollowupMaxDurationMs: VAD_DEFAULTS.followupMaxDurationMs,
    });
    await Promise.all([
      api.settingsSet(MIC_THRESHOLD_KEY, VAD_DEFAULTS.thresholdRms.toString()),
      api.settingsSet(MIC_SILENCE_KEY, VAD_DEFAULTS.silenceMs.toString()),
      api.settingsSet(
        MIC_INITIAL_WAIT_KEY,
        VAD_DEFAULTS.initialWaitMs.toString(),
      ),
      api.settingsSet(
        MIC_FOLLOWUP_INITIAL_KEY,
        VAD_DEFAULTS.followupInitialWaitMs.toString(),
      ),
      api.settingsSet(
        MIC_FOLLOWUP_MAX_KEY,
        VAD_DEFAULTS.followupMaxDurationMs.toString(),
      ),
    ]);
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

  setVoiceFollowupEnabled: async (enabled) => {
    set({ voiceFollowupEnabled: enabled });
    await api.settingsSet(VOICE_FOLLOWUP_KEY, enabled ? "true" : "false");
  },

  setWakeThreshold: async (v) => {
    const clamped = Math.max(0.5, Math.min(0.99, v));
    set({ wakeThreshold: clamped });
    await api.settingsSet(WAKE_THRESHOLD_KEY, clamped.toString());
  },

  setWakeDisplayLabel: async (v) => {
    const trimmed = v.trim().slice(0, 40);
    set({ wakeDisplayLabel: trimmed });
    await api.settingsSet(WAKE_DISPLAY_LABEL_KEY, trimmed);
  },
}));
