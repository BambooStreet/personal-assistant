import { create } from "zustand";

import { api } from "../lib/api";

// 인증 상태(원격 모드 Google 로그인). 로컬(dev) 모드면 main이 authStatus를 항상 signedIn=true로
// 반환 → 게이트 즉시 통과. auth.required 이벤트(세션 만료) 시 signed_out으로.

export type AuthStatus = "unknown" | "signed_in" | "signed_out";

interface AuthState {
  status: AuthStatus;
  email?: string;
  /** local: 로컬 Core(dev) — 온보딩 유지. remote: 클라우드 — 온보딩 스킵(이미 프로비저닝). */
  mode: "local" | "remote";
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  markRequired: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "unknown",
  mode: "remote",
  loading: false,
  error: null,

  load: async () => {
    try {
      const s = await api.authStatus();
      set({
        status: s.signedIn ? "signed_in" : "signed_out",
        email: s.email,
        mode: s.mode,
      });
    } catch {
      set({ status: "signed_out" });
    }
  },

  login: async () => {
    set({ loading: true, error: null });
    try {
      const s = await api.authLogin();
      set({
        status: s.signedIn ? "signed_in" : "signed_out",
        email: s.email,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  logout: async () => {
    try {
      await api.authLogout();
    } finally {
      set({ status: "signed_out", email: undefined });
    }
  },

  markRequired: () => set({ status: "signed_out", email: undefined }),
}));
