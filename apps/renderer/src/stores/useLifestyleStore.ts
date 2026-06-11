import { create } from "zustand";

import { api } from "../lib/api";

// 생활 프로필 — 일과 자동 배치(빈 슬롯 계산)의 입력.
// Core(schedule 모듈)가 settings에서 직접 읽으므로, 이 store는 설정 UI 편집용.
// 시각은 "HH:MM"(로컬 벽시계), blocks는 식사·취미·청소·금지시간을 통일한 "라벨 붙은 반복 블록".

const WAKE_WEEKDAY_KEY = "lifestyle.wake_weekday";
const SLEEP_WEEKDAY_KEY = "lifestyle.sleep_weekday";
const WAKE_WEEKEND_KEY = "lifestyle.wake_weekend";
const SLEEP_WEEKEND_KEY = "lifestyle.sleep_weekend";
const BLOCKS_KEY = "lifestyle.blocks";

export const LIFESTYLE_DEFAULTS = {
  wakeWeekday: "08:00",
  sleepWeekday: "23:00",
  wakeWeekend: "09:00",
  sleepWeekend: "23:00",
} as const;

// days: 0=월 … 6=일.
export interface LifestyleBlock {
  label: string;
  days: number[];
  start: string; // HH:MM
  end: string; // HH:MM
}

function isHHMM(s: unknown): s is string {
  return typeof s === "string" && /^(\d{2}):(\d{2})$/.test(s);
}

function normalizeHHMM(s: string | null, fallback: string): string {
  return isHHMM(s) ? s : fallback;
}

// JSON 문자열 → LifestyleBlock[]. 형식이 깨졌으면 빈 배열(안전).
function parseBlocks(raw: string | null): LifestyleBlock[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: LifestyleBlock[] = [];
    for (const it of arr) {
      const o = it as Partial<LifestyleBlock>;
      if (!isHHMM(o.start) || !isHHMM(o.end)) continue;
      const days = Array.isArray(o.days)
        ? o.days.filter((d) => typeof d === "number" && d >= 0 && d <= 6)
        : [];
      out.push({
        label: typeof o.label === "string" ? o.label : "",
        days,
        start: o.start,
        end: o.end,
      });
    }
    return out;
  } catch {
    return [];
  }
}

interface LifestyleStore {
  wakeWeekday: string;
  sleepWeekday: string;
  wakeWeekend: string;
  sleepWeekend: string;
  blocks: LifestyleBlock[];
  loaded: boolean;

  load: () => Promise<void>;
  setWakeWeekday: (v: string) => Promise<void>;
  setSleepWeekday: (v: string) => Promise<void>;
  setWakeWeekend: (v: string) => Promise<void>;
  setSleepWeekend: (v: string) => Promise<void>;
  setBlocks: (blocks: LifestyleBlock[]) => Promise<void>;
}

export const useLifestyleStore = create<LifestyleStore>((set) => ({
  wakeWeekday: LIFESTYLE_DEFAULTS.wakeWeekday,
  sleepWeekday: LIFESTYLE_DEFAULTS.sleepWeekday,
  wakeWeekend: LIFESTYLE_DEFAULTS.wakeWeekend,
  sleepWeekend: LIFESTYLE_DEFAULTS.sleepWeekend,
  blocks: [],
  loaded: false,

  load: async () => {
    try {
      const [wwd, swd, wwe, swe, blocks] = await Promise.all([
        api.settingsGet(WAKE_WEEKDAY_KEY),
        api.settingsGet(SLEEP_WEEKDAY_KEY),
        api.settingsGet(WAKE_WEEKEND_KEY),
        api.settingsGet(SLEEP_WEEKEND_KEY),
        api.settingsGet(BLOCKS_KEY),
      ]);
      set({
        wakeWeekday: normalizeHHMM(wwd, LIFESTYLE_DEFAULTS.wakeWeekday),
        sleepWeekday: normalizeHHMM(swd, LIFESTYLE_DEFAULTS.sleepWeekday),
        wakeWeekend: normalizeHHMM(wwe, LIFESTYLE_DEFAULTS.wakeWeekend),
        sleepWeekend: normalizeHHMM(swe, LIFESTYLE_DEFAULTS.sleepWeekend),
        blocks: parseBlocks(blocks),
        loaded: true,
      });
    } catch (e) {
      console.error("[pa] lifestyle load failed", e);
      set({ loaded: true });
    }
  },

  setWakeWeekday: async (v) => {
    const n = normalizeHHMM(v, LIFESTYLE_DEFAULTS.wakeWeekday);
    set({ wakeWeekday: n });
    await api.settingsSet(WAKE_WEEKDAY_KEY, n);
  },
  setSleepWeekday: async (v) => {
    const n = normalizeHHMM(v, LIFESTYLE_DEFAULTS.sleepWeekday);
    set({ sleepWeekday: n });
    await api.settingsSet(SLEEP_WEEKDAY_KEY, n);
  },
  setWakeWeekend: async (v) => {
    const n = normalizeHHMM(v, LIFESTYLE_DEFAULTS.wakeWeekend);
    set({ wakeWeekend: n });
    await api.settingsSet(WAKE_WEEKEND_KEY, n);
  },
  setSleepWeekend: async (v) => {
    const n = normalizeHHMM(v, LIFESTYLE_DEFAULTS.sleepWeekend);
    set({ sleepWeekend: n });
    await api.settingsSet(SLEEP_WEEKEND_KEY, n);
  },
  setBlocks: async (blocks) => {
    set({ blocks });
    await api.settingsSet(BLOCKS_KEY, JSON.stringify(blocks));
  },
}));
