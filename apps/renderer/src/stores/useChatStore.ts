import { create } from "zustand";

import { api, type ChatTurn, type ToolCall } from "../lib/api";
import { playBase64 } from "../lib/audio";
import {
  buildCards,
  buildCardsFromToolMessage,
  isSynthesizedRefresh,
  type ChatCard,
} from "../lib/chatCards";
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
  /** 읽기 도구 결과 카드(할 일·일정). 텍스트는 요약, 목록은 이 카드가 담당. */
  cards?: ChatCard[];
  /** DB persist 안 된 세션 한정 표시(예: wake 호출 인사). loadHistory가 보존. */
  uiOnly?: boolean;
}

interface ChatStore {
  bubbles: ChatBubble[];
  // 히스토리로 복원할 수 없는 세션 한정 카드(쓰기 승인 직후 Core가 합성한 갱신 목록).
  // loadHistory가 마지막 assistant 버블에 다시 붙여, 패널 재마운트에도 사라지지 않게 한다.
  sessionCards: ChatCard[] | null;
  sending: boolean;
  /** 진행 중인 턴의 단계 문구("할 일 찾아보는 중…"). Core의 chat.progress로 갱신. */
  progress: string | null;
  error: string | null;
  pendingTool: ToolCall | null;
  // 가장 최근 user 입력의 출처. confirmTool 후 응답을 voice로 재생할지 결정.
  lastUserSource: ChatBubbleSource | null;

  setProgress: (label: string | null) => void;
  loadHistory: () => Promise<void>;
  send: (text: string) => Promise<ChatTurn | null>;
  clear: () => Promise<void>;
  appendExternalTurn: (userText: string, turn: ChatTurn) => void;
  appendContinuedTurn: (turn: ChatTurn) => void;
  // wake-word 또는 단축키 호출 시 UI에만 표시 (DB persist 안 함, LLM context 미포함).
  appendWakeCall: (userName: string, displayLabel?: string) => void;
  // Core가 messages에 이미 저장한 assistant 메시지(루틴 알림 등)를 즉시 화면에 반영.
  // uiOnly가 아니다 — 다음 loadHistory에서 DB로부터 그대로 복원된다.
  appendAssistantText: (text: string) => void;
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
  sessionCards: null,
  sending: false,
  progress: null,
  error: null,
  pendingTool: null,
  lastUserSource: null,

  // sending이 아닐 때 들어온 신호는 버린다 — 클라우드 Core는 텔레그램 턴도 같은 이벤트를
  // 쏘므로, 내가 보낸 턴이 아닐 때 "찾아보는 중"이 뜨면 거짓말이 된다.
  setProgress: (label) =>
    set((s) => (s.sending ? { progress: label } : {})),

  loadHistory: async () => {
    try {
      const rows = await api.chatHistory(undefined, 200);
      // tool 행(읽기 도구 결과)을 카드로 복원해 **뒤따르는 assistant 응답**에 붙인다.
      // 순서는 user → assistant(tool_calls) → tool → assistant(text)라 이 방향이 맞다.
      const dbBubbles: ChatBubble[] = [];
      let pendingCards: ChatCard[] = [];
      for (const m of rows) {
        const ts = Date.parse(m.ts) || Date.now();
        if (m.role === "tool") {
          pendingCards = pendingCards.concat(
            buildCardsFromToolMessage(m.tool_name, m.content, `db${m.id}`),
          );
          continue;
        }
        if (m.role !== "user" && m.role !== "assistant") continue;
        const text = (m.content ?? "").trim();
        if (m.role === "user") {
          // 마무리 텍스트 없이 끊긴 턴의 카드는 다음 턴으로 넘기지 않고 버린다.
          pendingCards = [];
          if (text.length > 0) {
            dbBubbles.push({ id: `db${m.id}`, role: "user", text, ts });
          }
          continue;
        }
        if (text.length === 0 && pendingCards.length === 0) continue;
        dbBubbles.push({
          id: `db${m.id}`,
          role: "assistant",
          text,
          ts,
          cards: pendingCards.length > 0 ? pendingCards : undefined,
        });
        pendingCards = [];
      }
      // 세션 한정 카드(합성 갱신 목록)를 마지막 assistant 버블에 되붙인다.
      const sessionCards = get().sessionCards;
      if (sessionCards && sessionCards.length > 0) {
        for (let i = dbBubbles.length - 1; i >= 0; i--) {
          if (dbBubbles[i].role === "assistant") {
            if (!dbBubbles[i].cards) dbBubbles[i] = { ...dbBubbles[i], cards: sessionCards };
            break;
          }
        }
      }
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
      progress: null,
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
        progress: null,
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
        sessionCards: null,
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
    const cards = buildCards(turn.tool_results);
    const newBubbles: ChatBubble[] = [userBubble];
    // tool_call만 있고 텍스트 비면 placeholder bubble을 만들지 않음 (confirm 카드가 UI 역할).
    if (text || cards.length > 0) {
      newBubbles.push({
        id: nextId(),
        role: "assistant",
        text,
        ts: Date.now(),
        toolCalls: turn.tool_calls,
        cost: turn.cost_usd,
        cards: cards.length > 0 ? cards : undefined,
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
    const cards = buildCards(turn.tool_results);
    if (!text && cards.length === 0 && turn.tool_calls.length === 0) return;
    set((s) => {
      const newBubbles = [...s.bubbles];
      if (text || cards.length > 0) {
        newBubbles.push({
          id: nextId(),
          role: "assistant",
          text,
          ts: Date.now(),
          toolCalls: turn.tool_calls,
          cost: turn.cost_usd,
          cards: cards.length > 0 ? cards : undefined,
        });
      }
      return {
        bubbles: newBubbles,
        sessionCards: sessionCardsOf(turn),
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

  appendAssistantText: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((s) => ({
      bubbles: [
        ...s.bubbles,
        { id: nextId(), role: "assistant", text: trimmed, ts: Date.now() },
      ],
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
        progress: null,
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
        progress: null,
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
  const cards = buildCards(turn.tool_results);
  // 매 턴 덮어쓴다 — 합성 카드가 없는 턴이면 null이 되어 옛 카드가 새 메시지에 붙는 일이 없다.
  const sessionCards = sessionCardsOf(turn);
  set((s) => {
    let bubbles: ChatBubble[];
    if (text || cards.length > 0) {
      const final: ChatBubble = {
        id: placeholderId,
        role: "assistant",
        text,
        ts: Date.now(),
        toolCalls: turn.tool_calls,
        cost: turn.cost_usd,
        cards: cards.length > 0 ? cards : undefined,
      };
      bubbles = s.bubbles.map((b) => (b.id === placeholderId ? final : b));
    } else {
      bubbles = s.bubbles.filter((b) => b.id !== placeholderId);
    }
    return {
      bubbles,
      sessionCards,
      sending: false,
      progress: null,
      pendingTool: turn.tool_calls[0] ?? null,
    };
  });
}

/** 턴에 담긴 합성 갱신 결과만 골라 카드로. 없으면 null. */
function sessionCardsOf(turn: ChatTurn): ChatCard[] | null {
  const synthesized = (turn.tool_results ?? []).filter(isSynthesizedRefresh);
  if (synthesized.length === 0) return null;
  const cards = buildCards(synthesized);
  return cards.length > 0 ? cards : null;
}
