import { invoke } from "@tauri-apps/api/core";

export type SecretSlot =
  | "openai_api_key"
  | "google_client_id"
  | "google_client_secret";

export interface SecretStatus {
  slot: string;
  is_set: boolean;
  preview: string | null;
}

export interface AppHealth {
  db_ok: boolean;
  version: string;
}

export type FinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "content_filter"
  | "other";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatTurn {
  assistant_text: string | null;
  tool_calls: ToolCall[];
  finish_reason: FinishReason;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface StoredMessage {
  id: number;
  conversation_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  ts: string;
}

export interface Todo {
  id: number;
  title: string;
  notes: string | null;
  due_at: string | null;
  priority: number;
  done: boolean;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TodoDraft {
  title: string;
  notes?: string | null;
  due_at?: string | null;
  priority?: number | null;
}

export interface CostSummary {
  today_usd: number;
  month_usd: number;
  last_7_days_usd: number;
  total_calls: number;
}

export const api = {
  setSecret: (slot: SecretSlot, value: string) =>
    invoke<void>("secret_set", { slot, value }),
  deleteSecret: (slot: SecretSlot) =>
    invoke<void>("secret_delete", { slot }),
  secretStatus: (slot: SecretSlot) =>
    invoke<SecretStatus>("secret_status", { slot }),
  secretStatusAll: () => invoke<SecretStatus[]>("secret_status_all"),
  appHealth: () => invoke<AppHealth>("app_health"),

  chatSend: (userMessage: string, conversationId?: string) =>
    invoke<ChatTurn>("chat_send", {
      args: {
        user_message: userMessage,
        conversation_id: conversationId,
      },
    }),
  chatHistory: (conversationId?: string, limit?: number) =>
    invoke<StoredMessage[]>("chat_history", {
      conversationId,
      limit,
    }),
  chatClear: (conversationId?: string) =>
    invoke<number>("chat_clear", { conversationId }),
  costSummary: () => invoke<CostSummary>("cost_summary"),
  dailyCapGet: () => invoke<number>("daily_cap_get"),
  dailyCapSet: (value: number) => invoke<void>("daily_cap_set", { value }),
  settingsGet: (key: string) => invoke<string | null>("settings_get", { key }),
  settingsSet: (key: string, value: string) =>
    invoke<void>("settings_set", { key, value }),

  windowSetHitRegion: (
    rects: Array<{ x: number; y: number; w: number; h: number }>,
  ) => invoke<void>("window_set_hit_region", { rects }),

  // Electron paApi와 시그니처 매칭. Tauri는 늘 360x560 윈도우라 리사이즈 X.
  // 1.0에서는 hit-region을 좌하단 아바타 + 상단 패널(열림 시) 2개 사각형으로 고정.
  windowApplyPanelState: async (state: { open: boolean }): Promise<void> => {
    const avatarRect = { x: 0, y: 416, w: 144, h: 144 };
    const panelRect = { x: 0, y: 0, w: 360, h: 416 };
    const rects = state.open ? [panelRect, avatarRect] : [avatarRect];
    await invoke<void>("window_set_hit_region", { rects });
  },

  oauthGoogleStart: () =>
    invoke<{ connected: boolean }>("oauth_google_start"),
  oauthGoogleStatus: () =>
    invoke<{ connected: boolean }>("oauth_google_status"),
  oauthGoogleDisconnect: () => invoke<void>("oauth_google_disconnect"),

  todosList: (includeDone?: boolean) =>
    invoke<Todo[]>("todos_list", { includeDone }),
  todosCreate: (draft: TodoDraft) =>
    invoke<Todo>("todos_create", { draft }),
  todosComplete: (id: number) => invoke<Todo>("todos_complete", { id }),
  todosUncomplete: (id: number) => invoke<Todo>("todos_uncomplete", { id }),
  todosDelete: (id: number) => invoke<void>("todos_delete", { id }),

  calendarTodayEvents: () =>
    invoke<StoredEventLite[]>("calendar_today_events"),
  calendarUpcomingEvents: (days?: number) =>
    invoke<StoredEventLite[]>("calendar_upcoming_events", { days }),
  calendarSyncNow: () => invoke<SyncReport>("calendar_sync_now"),
  calendarCreateEvent: (draft: EventDraft) =>
    invoke<StoredEventLite>("calendar_create_event", { draft }),
  calendarDeleteEvent: (googleEventId: string) =>
    invoke<void>("calendar_delete_event", { googleEventId }),

  briefingToday: () =>
    invoke<BriefingPayload | null>("briefing_today"),
  briefingRun: (force?: boolean) =>
    invoke<BriefingPayload>("briefing_run", { force }),

  sttTranscribe: (audioB64: string, mime: string) =>
    invoke<TranscribeOutput>("stt_transcribe", {
      args: { audio_b64: audioB64, mime },
    }),
  ttsSpeak: (text: string, voice?: string) =>
    invoke<SpeakOutput>("tts_speak", {
      args: { text, voice },
    }),
};

export interface TranscribeOutput {
  text: string;
  duration_secs: number;
  cost_usd: number;
}

export interface SpeakOutput {
  audio_b64: string;
  mime: string;
  chars: number;
  cost_usd: number;
}

export interface BriefingPayload {
  date: string;
  summary: string;
  event_count: number;
  todo_count: number;
  created_at: string;
}

export interface StoredEventLite {
  id: number;
  google_event_id: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  status: string;
}

export interface EventDraft {
  summary: string;
  description?: string | null;
  location?: string | null;
  start_at: string;
  end_at: string;
  all_day?: boolean;
}

export interface SyncReport {
  fetched: number;
  upserts: number;
  deletions: number;
  full_sync: boolean;
}
