import { create } from "zustand";

import { api, type ChatTurn, type ToolCall } from "../lib/tauri";

export type ChatRole = "user" | "assistant";

export interface ChatBubble {
  id: string;
  role: ChatRole;
  text: string;
  ts: number;
  pending?: boolean;
  toolCalls?: ToolCall[];
  cost?: number;
}

interface ChatStore {
  bubbles: ChatBubble[];
  sending: boolean;
  error: string | null;
  pendingTool: ToolCall | null;

  loadHistory: () => Promise<void>;
  send: (text: string) => Promise<ChatTurn | null>;
  clear: () => Promise<void>;
  consumePendingTool: () => ToolCall | null;
  dismissPendingTool: () => void;
  setError: (e: string | null) => void;
}

let counter = 0;
const nextId = () => `b${Date.now()}_${++counter}`;

export const useChatStore = create<ChatStore>((set, get) => ({
  bubbles: [],
  sending: false,
  error: null,
  pendingTool: null,

  loadHistory: async () => {
    try {
      const rows = await api.chatHistory(undefined, 200);
      const bubbles: ChatBubble[] = rows
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => (m.content ?? "").trim().length > 0)
        .map((m) => ({
          id: `db${m.id}`,
          role: m.role as ChatRole,
          text: m.content ?? "",
          ts: Date.parse(m.ts) || Date.now(),
        }));
      set({ bubbles });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  send: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return null;

    const userBubble: ChatBubble = {
      id: nextId(),
      role: "user",
      text: trimmed,
      ts: Date.now(),
    };
    const placeholder: ChatBubble = {
      id: nextId(),
      role: "assistant",
      text: "",
      ts: Date.now(),
      pending: true,
    };
    set({
      bubbles: [...get().bubbles, userBubble, placeholder],
      sending: true,
      error: null,
    });

    try {
      const turn = await api.chatSend(trimmed);
      const final: ChatBubble = {
        id: placeholder.id,
        role: "assistant",
        text:
          (turn.assistant_text ?? "").trim() ||
          (turn.tool_calls.length > 0
            ? `(${turn.tool_calls[0].name} 제안)`
            : "(빈 응답)"),
        ts: Date.now(),
        toolCalls: turn.tool_calls,
        cost: turn.cost_usd,
      };
      set((s) => ({
        bubbles: s.bubbles.map((b) => (b.id === placeholder.id ? final : b)),
        sending: false,
        pendingTool: turn.tool_calls[0] ?? null,
      }));
      return turn;
    } catch (e) {
      set((s) => ({
        bubbles: s.bubbles.filter((b) => b.id !== placeholder.id),
        sending: false,
        error: String(e),
      }));
      return null;
    }
  },

  clear: async () => {
    try {
      await api.chatClear();
      set({ bubbles: [], pendingTool: null, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  consumePendingTool: () => {
    const t = get().pendingTool;
    set({ pendingTool: null });
    return t;
  },

  dismissPendingTool: () => set({ pendingTool: null }),
  setError: (e) => set({ error: e }),
}));
