import { contextBridge, ipcRenderer } from "electron";

const invoke = <T = unknown>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;

const subscribe = (event: string, cb: (data: unknown) => void): (() => void) => {
  const handler = (_e: unknown, data: unknown) => cb(data);
  ipcRenderer.on(`event:${event}`, handler);
  return () => {
    ipcRenderer.off(`event:${event}`, handler);
  };
};

const api = {
  // Bootstrap
  echo: (payload: unknown) => invoke<unknown>("echo", payload),

  // EM1: health
  appHealth: () => invoke<{ db_ok: boolean; version: string }>("appHealth"),

  // EM2: secrets
  setSecret: (slot: string, value: string) =>
    invoke<void>("setSecret", { slot, value }),
  deleteSecret: (slot: string) => invoke<void>("deleteSecret", { slot }),
  secretStatus: (slot: string) =>
    invoke<{ slot: string; is_set: boolean; preview: string | null }>(
      "secretStatus",
      { slot },
    ),
  secretStatusAll: () =>
    invoke<Array<{ slot: string; is_set: boolean; preview: string | null }>>(
      "secretStatusAll",
    ),

  // EM2: settings
  dailyCapGet: () => invoke<number>("dailyCapGet"),
  dailyCapSet: (value: number) => invoke<void>("dailyCapSet", { value }),
  settingsGet: (key: string) => invoke<string | null>("settingsGet", { key }),
  settingsSet: (key: string, value: string) =>
    invoke<void>("settingsSet", { key, value }),

  // EM3: chat
  chatSend: (userMessage: string, conversationId?: string) =>
    invoke("chatSend", { user_message: userMessage, conversation_id: conversationId }),
  chatHistory: (conversationId?: string, limit?: number) =>
    invoke("chatHistory", { conversation_id: conversationId, limit }),
  chatClear: (conversationId?: string) =>
    invoke<number>("chatClear", { conversation_id: conversationId }),
  costSummary: () => invoke("costSummary"),

  // EM3: todos
  todosList: (includeDone?: boolean) =>
    invoke("todosList", { include_done: includeDone }),
  todosCreate: (draft: unknown) => invoke("todosCreate", { draft }),
  todosComplete: (id: number) => invoke("todosComplete", { id }),
  todosUncomplete: (id: number) => invoke("todosUncomplete", { id }),
  todosDelete: (id: number) => invoke<void>("todosDelete", { id }),

  // EM4: OAuth
  oauthGoogleStart: () => invoke<{ connected: boolean }>("oauthGoogleStart"),
  oauthGoogleStatus: () => invoke<{ connected: boolean }>("oauthGoogleStatus"),
  oauthGoogleDisconnect: () => invoke<void>("oauthGoogleDisconnect"),

  // EM4: Calendar
  calendarTodayEvents: () => invoke("calendarTodayEvents"),
  calendarUpcomingEvents: (days?: number) =>
    invoke("calendarUpcomingEvents", { days }),
  calendarSyncNow: () => invoke("calendarSyncNow"),
  calendarCreateEvent: (draft: unknown) =>
    invoke("calendarCreateEvent", { draft }),
  calendarDeleteEvent: (googleEventId: string) =>
    invoke<void>("calendarDeleteEvent", { google_event_id: googleEventId }),

  // EM4: Briefing
  briefingToday: () => invoke("briefingToday"),
  briefingRun: (force?: boolean) => invoke("briefingRun", { force }),

  // EM5: Speech
  sttTranscribe: (audioB64: string, mime?: string) =>
    invoke("sttTranscribe", { audio_b64: audioB64, mime }),
  ttsSpeak: (text: string, voice?: string) =>
    invoke("ttsSpeak", { text, voice }),

  // Window 제어 (EM3.5 + EM6)
  windowMinimize: () => invoke<void>("windowMinimize"),
  windowClose: () => invoke<void>("windowClose"),
  windowStartDragging: () => invoke<void>("windowStartDragging"),
  windowStopDragging: () => invoke<void>("windowStopDragging"),
  windowSetClickThrough: (ignore: boolean) =>
    invoke<void>("windowSetClickThrough", ignore),
  windowSetPanelOpen: (open: boolean) =>
    invoke<void>("windowSetPanelOpen", open),
  autoLaunchGet: () => invoke<boolean>("autoLaunchGet"),
  autoLaunchSet: (enabled: boolean) =>
    invoke<void>("autoLaunchSet", enabled),

  // 이벤트 구독
  on: subscribe,
};

contextBridge.exposeInMainWorld("api", api);

export type ExposedApi = typeof api;
