import { contextBridge, ipcRenderer } from "electron";

import { Methods } from "@pa/ipc-types";

const invoke = <T = unknown>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;

const subscribe = (event: string, cb: (data: unknown) => void): (() => void) => {
  const handler = (_e: unknown, data: unknown) => cb(data);
  ipcRenderer.on(`event:${event}`, handler);
  return () => {
    ipcRenderer.off(`event:${event}`, handler);
  };
};

// 정적 런타임 정보 — wake telemetry session record에 박힘.
const versions = {
  electron: process.versions.electron ?? "",
  node: process.versions.node ?? "",
  chrome: process.versions.chrome ?? "",
} as const;

const platform = {
  os: process.platform,
  arch: process.arch,
} as const;

const api = {
  versions,
  platform,

  // Bootstrap
  echo: (payload: unknown) => invoke<unknown>(Methods.Echo, payload),

  // App
  appHealth: () => invoke<{ db_ok: boolean; version: string }>(Methods.AppHealth),

  // Secrets
  setSecret: (slot: string, value: string) =>
    invoke<void>(Methods.SecretSet, { slot, value }),
  deleteSecret: (slot: string) => invoke<void>(Methods.SecretDelete, { slot }),
  secretStatus: (slot: string) =>
    invoke<{ slot: string; is_set: boolean; preview: string | null }>(
      Methods.SecretStatus,
      { slot },
    ),
  secretStatusAll: () =>
    invoke<Array<{ slot: string; is_set: boolean; preview: string | null }>>(
      Methods.SecretStatusAll,
    ),

  // Settings
  dailyCapGet: () => invoke<number>(Methods.DailyCapGet),
  dailyCapSet: (value: number) => invoke<void>(Methods.DailyCapSet, { value }),
  settingsGet: (key: string) => invoke<string | null>(Methods.SettingsGet, { key }),
  settingsSet: (key: string, value: string) =>
    invoke<void>(Methods.SettingsSet, { key, value }),

  // Chat
  chatSend: (userMessage: string, conversationId?: string) =>
    invoke(Methods.ChatSend, {
      user_message: userMessage,
      conversation_id: conversationId,
    }),
  chatContinue: (payload: {
    conversation_id?: string;
    tool_call_id: string;
    tool_name: string;
    approved: boolean;
  }) => invoke(Methods.ChatContinue, payload),
  chatHistory: (conversationId?: string, limit?: number) =>
    invoke(Methods.ChatHistory, { conversation_id: conversationId, limit }),
  chatClear: (conversationId?: string) =>
    invoke<number>(Methods.ChatClear, { conversation_id: conversationId }),
  costSummary: () => invoke(Methods.CostSummary),

  // Auth (원격 모드 Google 로그인). mode=local이면 로그인/온보딩 게이트 통과.
  authLogin: () => invoke<{ signedIn: boolean; email?: string }>(Methods.AuthLogin),
  authStatus: () =>
    invoke<{ signedIn: boolean; email?: string; mode: "local" | "remote" }>(
      Methods.AuthStatus,
    ),
  authLogout: () => invoke<void>(Methods.AuthLogout),

  // Todos
  todosList: (includeDone?: boolean) =>
    invoke(Methods.TodosList, { include_done: includeDone }),
  todosCreate: (draft: unknown) => invoke(Methods.TodosCreate, { draft }),
  todosUpdate: (id: number, draft: unknown) =>
    invoke(Methods.TodosUpdate, { id, draft }),
  todosComplete: (id: number) => invoke(Methods.TodosComplete, { id }),
  todosUncomplete: (id: number) => invoke(Methods.TodosUncomplete, { id }),
  todosDelete: (id: number) => invoke<void>(Methods.TodosDelete, { id }),

  // OAuth
  oauthGoogleStart: () =>
    invoke<{ connected: boolean }>(Methods.OauthGoogleStart),
  oauthGoogleStatus: () =>
    invoke<{ connected: boolean }>(Methods.OauthGoogleStatus),
  oauthGoogleDisconnect: () => invoke<void>(Methods.OauthGoogleDisconnect),

  // Calendar
  calendarTodayEvents: () => invoke(Methods.CalendarToday),
  calendarUpcomingEvents: (days?: number) =>
    invoke(Methods.CalendarUpcoming, { days }),
  calendarSyncNow: () => invoke(Methods.CalendarSyncNow),
  calendarCreateEvent: (draft: unknown) =>
    invoke(Methods.CalendarCreate, { draft }),
  calendarUpdateEvent: (googleEventId: string, patch: unknown) =>
    invoke(Methods.CalendarUpdate, { google_event_id: googleEventId, patch }),
  calendarDeleteEvent: (googleEventId: string) =>
    invoke<void>(Methods.CalendarDelete, { google_event_id: googleEventId }),
  scheduleCommit: (items: unknown) =>
    invoke(Methods.ScheduleCommit, { items }),

  // Travel (이동시간/출발 알림)
  travelAliasList: () => invoke(Methods.TravelAliasList),
  travelAliasSet: (payload: { alias: string; query: string }) =>
    invoke(Methods.TravelAliasSet, payload),
  travelAliasDelete: (alias: string) =>
    invoke<void>(Methods.TravelAliasDelete, { alias }),
  travelToday: () => invoke(Methods.TravelToday),

  // Memory
  memoryRemember: (payload: {
    content: string;
    tags?: string[];
    conversation_id?: string;
  }) => invoke(Methods.MemoryRemember, payload),
  memorySearch: (query: string, limit?: number) =>
    invoke(Methods.MemorySearch, { query, limit }),

  // Briefing
  briefingToday: () => invoke(Methods.BriefingToday),
  briefingRun: (force?: boolean) => invoke(Methods.BriefingRun, { force }),

  // Speech
  sttTranscribe: (audioB64: string, mime?: string) =>
    invoke(Methods.SpeechTranscribe, { audio_b64: audioB64, mime }),
  ttsSpeak: (text: string, voice?: string) =>
    invoke(Methods.SpeechSpeak, { text, voice }),

  // Window. 드래그는 -webkit-app-region: drag CSS로 OS 네이티브 처리.
  windowClose: () => invoke<void>(Methods.WindowClose),
  windowSetClickThrough: (ignore: boolean) =>
    invoke<void>(Methods.WindowSetClickThrough, ignore),
  windowSetPanelOpen: (open: boolean) =>
    invoke<void>(Methods.WindowSetPanelOpen, open),
  windowSetAvatarState: (state: string) =>
    invoke<void>(Methods.WindowSetAvatarState, state),
  windowGetAvatarVisible: () =>
    invoke<boolean>(Methods.WindowGetAvatarVisible),
  windowBroadcast: (event: string, data: unknown) =>
    invoke<void>(Methods.WindowBroadcast, { event, data }),

  // AutoLaunch
  autoLaunchGet: () => invoke<boolean>(Methods.AutoLaunchGet),
  autoLaunchSet: (enabled: boolean) =>
    invoke<void>(Methods.AutoLaunchSet, enabled),

  // Debug telemetry — wake 측정 모드. 스키마는 docs/DECISIONS.md D-012.
  debugWakeLog: (
    payload:
      | { type: "open"; sessionId: string; record: unknown }
      | { type: "append"; sessionId: string; record: unknown }
      | { type: "close"; sessionId: string },
  ) => invoke<{ path?: string }>(Methods.DebugWakeLog, payload),

  // 이벤트 구독
  on: subscribe,
};

contextBridge.exposeInMainWorld("api", api);

export type ExposedApi = typeof api;
