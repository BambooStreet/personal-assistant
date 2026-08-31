import { create } from "zustand";

import {
  api,
  type GoalDetail,
  type GoalDraft,
  type RoutineDraft,
  type RoutinePatch,
} from "../lib/api";

// useTodoStore와 같은 결: 낙관적 갱신 없이 서버가 돌려준 엔티티로 교체한다.
// 루틴 변경은 목표에 중첩돼 있어 반환 엔티티만으로는 머지가 애매하므로 목록을 다시 읽는다
// (목표는 많아야 몇 개라 재조회 비용이 사실상 0).
interface GoalStore {
  goals: GoalDetail[];
  loading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  create: (draft: GoalDraft) => Promise<GoalDetail | null>;
  update: (id: number, draft: GoalDraft) => Promise<GoalDetail | null>;
  remove: (id: number) => Promise<void>;
  toggleMilestone: (id: number, done: boolean) => Promise<void>;
  addRoutine: (draft: RoutineDraft) => Promise<void>;
  patchRoutine: (id: number, patch: RoutinePatch) => Promise<void>;
  removeRoutine: (id: number) => Promise<void>;
}

export const useGoalStore = create<GoalStore>((set, get) => ({
  goals: [],
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const goals = await api.goalsList();
      set({ goals, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  create: async (draft) => {
    try {
      const created = await api.goalsCreate(draft);
      set({ goals: [...get().goals, created], error: null });
      return created;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  update: async (id, draft) => {
    try {
      const updated = await api.goalsUpdate(id, draft);
      set({
        goals: get().goals.map((g) => (g.id === id ? updated : g)),
        error: null,
      });
      return updated;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  // 체크 한 번에 목표 전체를 보내지 않는다 — Core가 해당 목표만 다시 만들어 돌려준다.
  toggleMilestone: async (id, done) => {
    try {
      const updated = await api.goalsMilestoneToggle(id, done);
      set({
        goals: get().goals.map((g) => (g.id === updated.id ? updated : g)),
        error: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  remove: async (id) => {
    try {
      await api.goalsDelete(id);
      set({ goals: get().goals.filter((g) => g.id !== id), error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addRoutine: async (draft) => {
    try {
      await api.goalsRoutineCreate(draft);
      set({ error: null });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  patchRoutine: async (id, patch) => {
    try {
      await api.goalsRoutineUpdate(id, patch);
      set({ error: null });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  removeRoutine: async (id) => {
    try {
      await api.goalsRoutineDelete(id);
      set({ error: null });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
