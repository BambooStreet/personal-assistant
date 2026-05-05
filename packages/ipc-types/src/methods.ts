// IPC 채널/RPC 메서드명 단일 출처.
// 한 값이 세 가지 역할을 동시에 수행:
//   1) Renderer ↔ Main IPC 채널명 (preload의 invoke / main의 ipcMain.handle)
//   2) Main → Core JSON-RPC 메서드명 (core가 forward 받는 메서드)
//   3) 신규 채널 추가 시 lint-enforced 단일 ID
//
// 모두 dot.case로 통일. 구조는 `<domain>.<verb>` (e.g. "chat.send").
// Window/AutoLaunch처럼 Main이 자체 처리하는 항목은 Core로 forward되지 않음.

export const Methods = {
  // App
  AppHealth: "app.health",

  // Secrets
  SecretSet: "secret.set",
  SecretDelete: "secret.delete",
  SecretStatus: "secret.status",
  SecretStatusAll: "secret.statusAll",

  // Settings
  SettingsGet: "settings.get",
  SettingsSet: "settings.set",
  DailyCapGet: "settings.dailyCapGet",
  DailyCapSet: "settings.dailyCapSet",

  // Chat
  ChatSend: "chat.send",
  ChatContinue: "chat.continue",
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

  // Memory
  MemoryRemember: "memory.remember",
  MemorySearch: "memory.search",

  // Briefing
  BriefingToday: "briefing.today",
  BriefingRun: "briefing.run",

  // Speech
  SpeechTranscribe: "speech.transcribe",
  SpeechSpeak: "speech.speak",

  // Window (Main 자체 처리, Core forward 없음)
  WindowClose: "window.close",
  WindowStartDragging: "window.startDragging",
  WindowStopDragging: "window.stopDragging",
  WindowSetClickThrough: "window.setClickThrough",
  WindowSetPanelOpen: "window.setPanelOpen",
  WindowSetAvatarState: "window.setAvatarState",
  WindowBroadcast: "window.broadcast",

  // AutoLaunch (Main 자체 처리)
  AutoLaunchGet: "autoLaunch.get",
  AutoLaunchSet: "autoLaunch.set",

  // Bootstrap
  Echo: "echo",
} as const;

export type MethodName = (typeof Methods)[keyof typeof Methods];

// Core(Rust)로 forward되는 메서드 — Main이 자체 처리하지 않는 것.
// dispatch 테이블 작성 시 사용 가능. 키는 Methods의 어떤 항목인지 보여주려고 const-typed.
export const CORE_FORWARD_METHODS = [
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
  Methods.ChatContinue,
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
  Methods.MemoryRemember,
  Methods.MemorySearch,
  Methods.BriefingToday,
  Methods.BriefingRun,
  Methods.SpeechTranscribe,
  Methods.SpeechSpeak,
] as const satisfies ReadonlyArray<MethodName>;
