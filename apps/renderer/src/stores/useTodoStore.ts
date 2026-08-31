import { create } from "zustand";

import { api, type Todo, type TodoDraft } from "../lib/api";

interface TodoStore {
  todos: Todo[];
  loading: boolean;
  error: string | null;

  refresh: (includeDone?: boolean) => Promise<void>;
  create: (draft: TodoDraft) => Promise<Todo | null>;
  update: (id: number, draft: TodoDraft) => Promise<Todo | null>;
  /** 목표에 연결/해제. update가 draft 전체 교체라 나머지 필드를 다시 실어야 해서 여기서만 처리한다. */
  linkGoal: (id: number, goalId: number | null) => Promise<void>;
  /** finish=true면 반복 할 일도 완료로 마감한다(기본은 다음 주기로 전진). */
  toggle: (id: number, done: boolean, finish?: boolean) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  loading: false,
  error: null,

  refresh: async (includeDone) => {
    set({ loading: true, error: null });
    try {
      const todos = await api.todosList(includeDone ?? true);
      set({ todos, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  create: async (draft) => {
    try {
      const created = await api.todosCreate(draft);
      set({ todos: [created, ...get().todos] });
      return created;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  update: async (id, draft) => {
    try {
      const updated = await api.todosUpdate(id, draft);
      set({ todos: get().todos.map((t) => (t.id === id ? updated : t)) });
      return updated;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  linkGoal: async (id, goalId) => {
    const t = get().todos.find((x) => x.id === id);
    if (!t) return;
    // ⚠️ 전체 교체다. 한 필드만 보내면 나머지가 전부 지워진다.
    await get().update(id, {
      title: t.title,
      notes: t.notes,
      due_at: t.due_at,
      priority: t.priority,
      recur: t.recur,
      estimated_minutes: t.estimated_minutes,
      difficulty: t.difficulty,
      trigger_slot: t.trigger_slot,
      goal_id: goalId,
    });
  },

  toggle: async (id, done, finish) => {
    try {
      const updated = done
        ? await api.todosComplete(id, finish)
        : await api.todosUncomplete(id);
      set({ todos: get().todos.map((t) => (t.id === id ? updated : t)) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  remove: async (id) => {
    try {
      await api.todosDelete(id);
      set({ todos: get().todos.filter((t) => t.id !== id) });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
