// IPC 채널/RPC 메서드명. dot.case로 정규화.
// Renderer ↔ Main IPC와 Main ↔ Core JSON-RPC 양쪽에서 동일 키 사용.

export const Methods = {
  // App
  AppHealth: "app.health",

  // Settings / Secrets
  SecretSet: "secret.set",
  SecretDelete: "secret.delete",
  SecretStatus: "secret.status",
  SecretStatusAll: "secret.statusAll",
  SettingsGet: "settings.get",
  SettingsSet: "settings.set",
  DailyCapGet: "settings.dailyCapGet",
  DailyCapSet: "settings.dailyCapSet",

  // Chat
  ChatSend: "chat.send",
  ChatHistory: "chat.history",
  ChatClear: "chat.clear",
  CostSummary: "chat.costSummary",

  // Todos
  TodosList: "todos.list",
  TodosCreate: "todos.create",
  TodosComplete: "todos.complete",
  TodosUncomplete: "todos.uncomplete",
  TodosDelete: "todos.delete",

  // OAuth (Google)
  OauthGoogleStart: "oauth.googleStart",
  OauthGoogleStatus: "oauth.googleStatus",
  OauthGoogleDisconnect: "oauth.googleDisconnect",

  // Calendar
  CalendarToday: "calendar.today",
  CalendarUpcoming: "calendar.upcoming",
  CalendarSyncNow: "calendar.syncNow",
  CalendarCreate: "calendar.create",
  CalendarDelete: "calendar.delete",

  // Briefing
  BriefingToday: "briefing.today",
  BriefingRun: "briefing.run",

  // Speech
  SpeechStt: "speech.stt",
  SpeechTts: "speech.tts",

  // Window (Main 자체 처리, Core로 forward 안 함)
  WindowMinimize: "window.minimize",
  WindowClose: "window.close",
  WindowStartDragging: "window.startDragging",
  WindowSetHitRegion: "window.setHitRegion",
  WindowOuterPosition: "window.outerPosition",
  WindowSetPosition: "window.setPosition",
  WindowScaleFactor: "window.scaleFactor",
  WindowCurrentMonitor: "window.currentMonitor",
  WindowPrimaryMonitor: "window.primaryMonitor",

  // Bootstrap (EM0 임시)
  Echo: "echo",
} as const;

export type MethodName = (typeof Methods)[keyof typeof Methods];

// Core(Rust)로 forward되는 메서드 (Main이 자체 처리하지 않는 것)
export const CORE_FORWARD_METHODS: ReadonlyArray<MethodName> = [
  Methods.AppHealth,
  Methods.SecretSet,
  Methods.SecretDelete,
  Methods.SecretStatus,
  Methods.SecretStatusAll,
  Methods.SettingsGet,
  Methods.SettingsSet,
  Methods.DailyCapGet,
  Methods.DailyCapSet,
  Methods.ChatSend,
  Methods.ChatHistory,
  Methods.ChatClear,
  Methods.CostSummary,
  Methods.TodosList,
  Methods.TodosCreate,
  Methods.TodosComplete,
  Methods.TodosUncomplete,
  Methods.TodosDelete,
  Methods.OauthGoogleStart,
  Methods.OauthGoogleStatus,
  Methods.OauthGoogleDisconnect,
  Methods.CalendarToday,
  Methods.CalendarUpcoming,
  Methods.CalendarSyncNow,
  Methods.CalendarCreate,
  Methods.CalendarDelete,
  Methods.BriefingToday,
  Methods.BriefingRun,
  Methods.SpeechStt,
  Methods.SpeechTts,
];
