import { create } from "zustand";

import { api, type ChatTurn, type ToolCall } from "../lib/api";
import { playBase64 } from "../lib/audio";
import { useCalendarStore } from "./useCalendarStore";
import { useTodoStore } from "./useTodoStore";
import { useUserSettingsStore } from "./useUserSettingsStore";

export type ChatRole = "user" | "assistant";
export type ChatBubbleSource = "voice" | "text";

export interface ChatBubble {
  id: string;
  role: ChatRole;
  text: string;
  ts: number;
  pending?: boolean;
  toolCalls?: ToolCall[];
  cost?: number;
  source?: ChatBubbleSource;
  /** DB persist 안 된 세션 한정 표시(예: wake 호출 인사). loadHistory가 보존. */
  uiOnly?: boolean;
}

interface ChatStore {
  bubbles: ChatBubble[];
  sending: boolean;
  error: string | null;
  pendingTool: ToolCall | null;
  // 가장 최근 user 입력의 출처. confirmTool 후 응답을 voice로 재생할지 결정.
  lastUserSource: ChatBubbleSource | null;

  loadHistory: () => Promise<void>;
  send: (text: string) => Promise<ChatTurn | null>;
  clear: () => Promise<void>;
  appendExternalTurn: (userText: string, turn: ChatTurn) => void;
  appendContinuedTurn: (turn: ChatTurn) => void;
  // wake-word 또는 단축키 호출 시 UI에만 표시 (DB persist 안 함, LLM context 미포함).
  appendWakeCall: (userName: string, displayLabel?: string) => void;
  consumePendingTool: () => ToolCall | null;
  dismissPendingTool: () => void;
  // 사용자 confirm → Core가 쓰기 도구 실행(4b) → 마무리 응답 받기. 클라이언트는 승인만 보냄.
  confirmTool: (call: ToolCall) => Promise<void>;
  // 사용자 거부 → LLM에 거부됨 알림 → 마무리 응답 받기.
  rejectTool: (call: ToolCall) => Promise<void>;
  // voice 사이클이 emit한 confirm/reject 요청 처리. pendingTool과 id 매칭되면 자동 실행.
  confirmPendingByVoice: (toolCallId: string) => Promise<void>;
  rejectPendingByVoice: (toolCallId: string) => Promise<void>;
  setError: (e: string | null) => void;
}

let counter = 0;
const nextId = () => `b${Date.now()}_${++counter}`;

// 응답 텍스트를 TTS로 재생 + 아바타 speaking 애니메이션. 마지막 user 입력이 voice였을 때만 호출.
async function playVoiceResponse(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const voice = useUserSettingsStore.getState().voice;
  try {
    await api.windowSetAvatarState("speaking");
    const out = await api.ttsSpeak(trimmed, voice);
    const handle = await playBase64(out.audio_b64, out.mime);
    await new Promise<void>((resolve) => {
      const done = () => {
        handle.audio.removeEventListener("ended", done);
        handle.audio.removeEventListener("error", done);
        resolve();
      };
      handle.audio.addEventListener("ended", done);
      handle.audio.addEventListener("error", done);
    });
  } catch (e) {
    console.warn("[chat] voice response playback failed", e);
  } finally {
    await api.windowSetAvatarState("idle").catch(() => {});
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  bubbles: [],
  sending: false,
  error: null,
  pendingTool: null,
  lastUserSource: null,

  loadHistory: async () => {
    try {
      const rows = await api.chatHistory(undefined, 200);
      const dbBubbles: ChatBubble[] = rows
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => (m.content ?? "").trim().length > 0)
        .map((m) => ({
          id: `db${m.id}`,
          role: m.role as ChatRole,
          text: m.content ?? "",
          ts: Date.parse(m.ts) || Date.now(),
        }));
      // 세션 한정 UI 메시지(wake 호출 등)는 DB에 없지만 store에 있으면 유지.
      const uiOnly = get().bubbles.filter((b) => b.uiOnly);
      const merged = [...dbBubbles, ...uiOnly].sort((a, b) => a.ts - b.ts);
      set({ bubbles: merged });
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
      source: "text",
    };
    const placeholderId = nextId();
    set({
      bubbles: [
        ...get().bubbles,
        userBubble,
        {
          id: placeholderId,
          role: "assistant",
          text: "",
          ts: Date.now(),
          pending: true,
        },
      ],
      sending: true,
      error: null,
      lastUserSource: "text",
    });

    try {
      const turn = await api.chatSend(trimmed);
      finalizeTurn(set, placeholderId, turn);
      return turn;
    } catch (e) {
      set((s) => ({
        bubbles: s.bubbles.filter((b) => b.id !== placeholderId),
        sending: false,
        error: String(e),
      }));
      return null;
    }
  },

  clear: async () => {
    try {
      await api.chatClear();
      set({
        bubbles: [],
        pendingTool: null,
        error: null,
        lastUserSource: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // 다른 윈도우(AvatarApp의 voice cycle)가 chat.send를 한 결과를 그대로 패널에 반영.
  appendExternalTurn: (userText, turn) => {
    const userBubble: ChatBubble = {
      id: nextId(),
      role: "user",
      text: userText.trim(),
      ts: Date.now(),
      source: "voice",
    };
    const text = (turn.assistant_text ?? "").trim();
    const newBubbles: ChatBubble[] = [userBubble];
    // tool_call만 있고 텍스트 비면 placeholder bubble을 만들지 않음 (confirm 카드가 UI 역할).
    if (text) {
      newBubbles.push({
        id: nextId(),
        role: "assistant",
        text,
        ts: Date.now(),
        toolCalls: turn.tool_calls,
        cost: turn.cost_usd,
      });
    }
    set((s) => ({
      bubbles: [...s.bubbles, ...newBubbles],
      pendingTool: turn.tool_calls[0] ?? s.pendingTool,
      lastUserSource: "voice",
    }));
  },

  // 다른 윈도우가 chat.continue를 한 결과 (도구 confirm 후 LLM 마무리)를 패널에 반영.
  // user bubble은 추가하지 않음 (이미 있던 turn의 후속).
  appendContinuedTurn: (turn) => {
    const text = (turn.assistant_text ?? "").trim();
    if (!text && turn.tool_calls.length === 0) return;
    set((s) => {
      const newBubbles = [...s.bubbles];
      if (text) {
        newBubbles.push({
          id: nextId(),
          role: "assistant",
          text,
          ts: Date.now(),
          toolCalls: turn.tool_calls,
          cost: turn.cost_usd,
        });
      }
      return {
        bubbles: newBubbles,
        pendingTool: turn.tool_calls[0] ?? s.pendingTool,
      };
    });
  },

  appendWakeCall: (userName, displayLabel) => {
    const trimmed = userName.trim();
    const greeting = trimmed.length > 0 ? `네, ${trimmed}님` : "네, 부르셨나요";
    const label = (displayLabel ?? "").trim();
    const now = Date.now();
    const userBubble: ChatBubble = {
      id: nextId(),
      role: "user",
      text: label.length > 0 ? label : "(부름)",
      ts: now,
      source: "voice",
      uiOnly: true,
    };
    const greetingBubble: ChatBubble = {
      id: nextId(),
      role: "assistant",
      text: greeting,
      ts: now + 1,
      uiOnly: true,
    };
    set((s) => ({
      bubbles: [...s.bubbles, userBubble, greetingBubble],
      lastUserSource: "voice",
    }));
  },

  consumePendingTool: () => {
    const t = get().pendingTool;
    set({ pendingTool: null });
    return t;
  },

  dismissPendingTool: () => set({ pendingTool: null }),

  confirmTool: async (call) => {
    if (get().sending) return;
    const placeholderId = nextId();
    set((s) => ({
      bubbles: [
        ...s.bubbles,
        {
          id: placeholderId,
          role: "assistant",
          text: "",
          ts: Date.now(),
          pending: true,
        },
      ],
      sending: true,
      pendingTool: null,
      error: null,
    }));
    const wasVoice = get().lastUserSource === "voice";
    try {
      // (4b) Core가 쓰기 도구를 직접 실행 → 클라이언트는 승인만 전달.
      const turn = await api.chatContinue({
        tool_call_id: call.id,
        tool_name: call.name,
        approved: true,
      });
      finalizeTurn(set, placeholderId, turn);
      // 쓰기 커밋은 Core에서 일어났으므로 관련 스토어를 새로고침(어떤 도구든 무해).
      void useTodoStore.getState().refresh(true).catch(() => {});
      void useCalendarStore.getState().refreshToday().catch(() => {});
      const reply = (turn.assistant_text ?? "").trim();
      if (wasVoice && reply) {
        await playVoiceResponse(reply);
      }
    } catch (e) {
      set((s) => ({
        bubbles: s.bubbles.filter((b) => b.id !== placeholderId),
        sending: false,
        error: String(e),
      }));
    }
  },

  rejectTool: async (call) => {
    if (get().sending) return;
    const placeholderId = nextId();
    set((s) => ({
      bubbles: [
        ...s.bubbles,
        {
          id: placeholderId,
          role: "assistant",
          text: "",
          ts: Date.now(),
          pending: true,
        },
      ],
      sending: true,
      pendingTool: null,
      error: null,
    }));
    const wasVoice = get().lastUserSource === "voice";
    try {
      const turn = await api.chatContinue({
        tool_call_id: call.id,
        tool_name: call.name,
        approved: false,
      });
      finalizeTurn(set, placeholderId, turn);
      const reply = (turn.assistant_text ?? "").trim();
      if (wasVoice && reply) {
        await playVoiceResponse(reply);
      }
    } catch (e) {
      set((s) => ({
        bubbles: s.bubbles.filter((b) => b.id !== placeholderId),
        sending: false,
        error: String(e),
      }));
    }
  },

  confirmPendingByVoice: async (toolCallId) => {
    const pending = get().pendingTool;
    if (!pending || pending.id !== toolCallId) {
      console.info("[chat] voice confirm ignored — no matching pending tool");
      return;
    }
    await get().confirmTool(pending);
  },

  rejectPendingByVoice: async (toolCallId) => {
    const pending = get().pendingTool;
    if (!pending || pending.id !== toolCallId) {
      console.info("[chat] voice reject ignored — no matching pending tool");
      return;
    }
    await get().rejectTool(pending);
  },

  setError: (e) => set({ error: e }),
}));

type SetFn = (
  fn: (s: ChatStore) => Partial<ChatStore> | ChatStore,
) => void;

// 응답 turn으로 placeholder bubble 마무리. 텍스트가 있으면 placeholder를 그것으로 교체,
// 텍스트 없고 tool_call만 있으면 placeholder를 제거 (confirm 카드가 표시됨).
function finalizeTurn(
  set: SetFn,
  placeholderId: string,
  turn: ChatTurn,
): void {
  const text = (turn.assistant_text ?? "").trim();
  set((s) => {
    let bubbles: ChatBubble[];
    if (text) {
      const final: ChatBubble = {
        id: placeholderId,
        role: "assistant",
        text,
        ts: Date.now(),
        toolCalls: turn.tool_calls,
        cost: turn.cost_usd,
      };
      bubbles = s.bubbles.map((b) => (b.id === placeholderId ? final : b));
    } else {
      bubbles = s.bubbles.filter((b) => b.id !== placeholderId);
    }
    return {
      bubbles,
      sending: false,
      pendingTool: turn.tool_calls[0] ?? null,
    };
  });
}
