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
  AppVersion: "app.version",

  // Update (Main 자체 처리 — electron-updater. Core forward 없음).
  // 상태 진행은 IPC 메서드가 아니라 `update.status` 이벤트로 push.
  UpdateCheck: "update.check",
  UpdateInstall: "update.install",

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
  TodosUpdate: "todos.update",
  TodosComplete: "todos.complete",
  TodosUncomplete: "todos.uncomplete",
  TodosDelete: "todos.delete",

  // Goals (목표 + 루틴 알림)
  GoalsList: "goals.list",
  GoalsCreate: "goals.create",
  GoalsUpdate: "goals.update",
  GoalsDelete: "goals.delete",
  GoalsRoutineCreate: "goals.routineCreate",
  GoalsRoutineUpdate: "goals.routineUpdate",
  GoalsRoutineDelete: "goals.routineDelete",

  // OAuth (Google)
  OauthGoogleStart: "oauth.googleStart",
  OauthGoogleStatus: "oauth.googleStatus",
  OauthGoogleDisconnect: "oauth.googleDisconnect",

  // Calendar
  CalendarToday: "calendar.today",
  CalendarUpcoming: "calendar.upcoming",
  CalendarSyncNow: "calendar.syncNow",
  CalendarCreate: "calendar.create",
  CalendarUpdate: "calendar.update",
  CalendarDelete: "calendar.delete",

  // Schedule (일과 자동 배치)
  ScheduleCommit: "schedule.commit",

  // Travel (이동시간/출발 알림 — 장소 별칭 관리 + 오늘 이동 조회)
  TravelAliasList: "travel.aliasList",
  TravelAliasSet: "travel.aliasSet",
  TravelAliasDelete: "travel.aliasDelete",
  TravelToday: "travel.today",

  // Memory
  MemoryRemember: "memory.remember",
  MemorySearch: "memory.search",

  // Briefing
  BriefingToday: "briefing.today",
  BriefingRun: "briefing.run",

  // Greeting — 앱 시작 인사. 브리핑과 주기가 다르다(실행마다 + 쿨다운).
  // 응답에 아침 브리핑을 동봉하므로 부팅은 이 호출 하나로 끝난다.
  GreetingRun: "greeting.run",

  // Speech
  SpeechTranscribe: "speech.transcribe",
  SpeechSpeak: "speech.speak",

  // Window (Main 자체 처리, Core forward 없음).
  // 드래그는 -webkit-app-region: drag CSS로 OS 네이티브 처리 — IPC 없음.
  WindowClose: "window.close",
  WindowMinimize: "window.minimize",
  WindowSetClickThrough: "window.setClickThrough",
  WindowSetPanelOpen: "window.setPanelOpen",
  WindowSetAvatarState: "window.setAvatarState",
  WindowGetAvatarVisible: "window.getAvatarVisible",
  WindowBroadcast: "window.broadcast",

  // Auth (Main 자체 처리, Core forward 없음 — 클라우드 게이트웨이와만 통신).
  AuthLogin: "auth.login",
  AuthStatus: "auth.status",
  AuthLogout: "auth.logout",

  // AutoLaunch (Main 자체 처리)
  AutoLaunchGet: "autoLaunch.get",
  AutoLaunchSet: "autoLaunch.set",

  // Debug telemetry (Main 자체 처리, Core forward 없음)
  // wake 측정 모드에서 NDJSON 파일에 기록. 스키마는 docs/DECISIONS.md D-012 참조.
  DebugWakeLog: "debug.wakeLog",

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
  Methods.TodosUpdate,
  Methods.TodosComplete,
  Methods.TodosUncomplete,
  Methods.TodosDelete,
  Methods.GoalsList,
  Methods.GoalsCreate,
  Methods.GoalsUpdate,
  Methods.GoalsDelete,
  Methods.GoalsRoutineCreate,
  Methods.GoalsRoutineUpdate,
  Methods.GoalsRoutineDelete,
  Methods.OauthGoogleStart,
  Methods.OauthGoogleStatus,
  Methods.OauthGoogleDisconnect,
  Methods.CalendarToday,
  Methods.CalendarUpcoming,
  Methods.CalendarSyncNow,
  Methods.CalendarCreate,
  Methods.CalendarUpdate,
  Methods.CalendarDelete,
  Methods.ScheduleCommit,
  Methods.TravelAliasList,
  Methods.TravelAliasSet,
  Methods.TravelAliasDelete,
  Methods.TravelToday,
  Methods.MemoryRemember,
  Methods.MemorySearch,
  Methods.BriefingToday,
  Methods.BriefingRun,
  Methods.GreetingRun,
  Methods.SpeechTranscribe,
  Methods.SpeechSpeak,
] as const satisfies ReadonlyArray<MethodName>;
