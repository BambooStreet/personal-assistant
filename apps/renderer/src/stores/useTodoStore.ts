import { create } from "zustand";

import { api, type Todo, type TodoDraft } from "../lib/runtime";

interface TodoStore {
  todos: Todo[];
  loading: boolean;
  error: string | null;

  refresh: (includeDone?: boolean) => Promise<void>;
  create: (draft: TodoDraft) => Promise<Todo | null>;
  toggle: (id: number, done: boolean) => Promise<void>;
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

  toggle: async (id, done) => {
    try {
      const updated = done
        ? await api.todosComplete(id)
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
