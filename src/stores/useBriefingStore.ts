import { create } from "zustand";

import { api, type BriefingPayload } from "../lib/tauri";

interface BriefingStore {
  briefing: BriefingPayload | null;
  loading: boolean;
  dismissed: boolean;
  error: string | null;
  initialized: boolean;
  pendingAutoPlay: boolean;

  bootstrap: () => Promise<{ created: boolean } | null>;
  refresh: () => Promise<void>;
  dismiss: () => void;
  consumeAutoPlay: () => boolean;
}

export const useBriefingStore = create<BriefingStore>((set, get) => ({
  briefing: null,
  loading: false,
  dismissed: false,
  error: null,
  initialized: false,
  pendingAutoPlay: false,

  bootstrap: async () => {
    if (get().initialized) return null;
    set({ loading: true, error: null, initialized: true });
    try {
      const existing = await api.briefingToday();
      if (existing) {
        set({ briefing: existing, loading: false });
        return { created: false };
      }
      const fresh = await api.briefingRun(false);
      set({ briefing: fresh, loading: false, pendingAutoPlay: true });
      return { created: true };
    } catch (e) {
      set({ loading: false, error: String(e) });
      return null;
    }
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const fresh = await api.briefingRun(true);
      set({ briefing: fresh, loading: false, dismissed: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  dismiss: () => set({ dismissed: true }),
  consumeAutoPlay: () => {
    const v = get().pendingAutoPlay;
    if (v) set({ pendingAutoPlay: false });
    return v;
  },
}));
