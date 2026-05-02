// Electron preload(`window.api.*`)를 호출하는 타입 안전 래퍼.
// 기존 lib/tauri.ts와 **동일한 flat 시그니처**로 노출 — 컴포넌트는 import 경로만 바꾸면 됨.
//
// EM0 단계: 대부분 메서드는 stub. window.api에 아직 메서드가 없으면 reject Promise를 반환.
// (sync throw하면 React 트리가 깨지므로 항상 Promise 경로로.)
// EM1부터 Main에서 실제 채널이 채워지면 자동 동작.

import type {
  AppHealth,
  BriefingPayload,
  ChatTurn,
  CostSummary,
  EventDraft,
  SecretSlot,
  SecretStatus,
  SpeakOutput,
  StoredEventLite,
  StoredMessage,
  SyncReport,
  Todo,
  TodoDraft,
  TranscribeOutput,
} from "@pa/ipc-types";

declare global {
  interface Window {
    api?: ElectronApi;
  }
}

interface ElectronApi {
  // bootstrap
  echo: (payload: unknown) => Promise<unknown>;
  on: (event: string, cb: (data: unknown) => void) => () => void;

  // EM1 이후 추가될 메서드들 — 모두 optional로 선언 (점진 채움)
  appHealth?: () => Promise<AppHealth>;
  setSecret?: (slot: SecretSlot, value: string) => Promise<void>;
  deleteSecret?: (slot: SecretSlot) => Promise<void>;
  secretStatus?: (slot: SecretSlot) => Promise<SecretStatus>;
  secretStatusAll?: () => Promise<SecretStatus[]>;
  dailyCapGet?: () => Promise<number>;
  dailyCapSet?: (value: number) => Promise<void>;
  settingsGet?: (key: string) => Promise<string | null>;
  settingsSet?: (key: string, value: string) => Promise<void>;

  chatSend?: (userMessage: string, conversationId?: string) => Promise<ChatTurn>;
  chatHistory?: (
    conversationId?: string,
    limit?: number,
  ) => Promise<StoredMessage[]>;
  chatClear?: (conversationId?: string) => Promise<number>;
  costSummary?: () => Promise<CostSummary>;

  todosList?: (includeDone?: boolean) => Promise<Todo[]>;
  todosCreate?: (draft: TodoDraft) => Promise<Todo>;
  todosComplete?: (id: number) => Promise<Todo>;
  todosUncomplete?: (id: number) => Promise<Todo>;
  todosDelete?: (id: number) => Promise<void>;

  oauthGoogleStart?: () => Promise<{ connected: boolean }>;
  oauthGoogleStatus?: () => Promise<{ connected: boolean }>;
  oauthGoogleDisconnect?: () => Promise<void>;

  calendarTodayEvents?: () => Promise<StoredEventLite[]>;
  calendarUpcomingEvents?: (days?: number) => Promise<StoredEventLite[]>;
  calendarSyncNow?: () => Promise<SyncReport>;
  calendarCreateEvent?: (draft: EventDraft) => Promise<StoredEventLite>;
  calendarDeleteEvent?: (googleEventId: string) => Promise<void>;

  briefingToday?: () => Promise<BriefingPayload | null>;
  briefingRun?: (force?: boolean) => Promise<BriefingPayload>;

  sttTranscribe?: (audioB64: string, mime: string) => Promise<TranscribeOutput>;
  ttsSpeak?: (text: string, voice?: string) => Promise<SpeakOutput>;

  // Window 관련 (Main이 직접 처리)
  windowMinimize?: () => Promise<void>;
  windowClose?: () => Promise<void>;
  windowStartDragging?: () => Promise<void>;
  windowStopDragging?: () => Promise<void>;
  windowApplyPanelState?: (state: { open: boolean }) => Promise<void>;
}

const api = (typeof window !== "undefined" ? window.api : undefined) as
  | ElectronApi
  | undefined;

function notReady<T>(method: string): Promise<T> {
  return Promise.reject(
    new Error(
      `[pa] window.api.${method}는 아직 Main에 등록되지 않았습니다 (EM 단계 진행 중)`,
    ),
  );
}

const noop = async (_method: string): Promise<void> => {
  // window 제어 메서드는 stub 시 graceful no-op (React 트리 흐름 방해 X)
  // 디버깅 위해 한 번만 warn
};

// 기존 lib/tauri.ts와 동일한 flat 시그니처
export const paApi = {
  appHealth: (): Promise<AppHealth> =>
    api?.appHealth ? api.appHealth() : notReady("appHealth"),

  setSecret: (slot: SecretSlot, value: string): Promise<void> =>
    api?.setSecret ? api.setSecret(slot, value) : notReady("setSecret"),
  deleteSecret: (slot: SecretSlot): Promise<void> =>
    api?.deleteSecret ? api.deleteSecret(slot) : notReady("deleteSecret"),
  secretStatus: (slot: SecretSlot): Promise<SecretStatus> =>
    api?.secretStatus ? api.secretStatus(slot) : notReady("secretStatus"),
  secretStatusAll: (): Promise<SecretStatus[]> =>
    api?.secretStatusAll ? api.secretStatusAll() : notReady("secretStatusAll"),

  dailyCapGet: (): Promise<number> =>
    api?.dailyCapGet ? api.dailyCapGet() : notReady("dailyCapGet"),
  dailyCapSet: (value: number): Promise<void> =>
    api?.dailyCapSet ? api.dailyCapSet(value) : notReady("dailyCapSet"),
  settingsGet: (key: string): Promise<string | null> =>
    api?.settingsGet ? api.settingsGet(key) : notReady("settingsGet"),
  settingsSet: (key: string, value: string): Promise<void> =>
    api?.settingsSet ? api.settingsSet(key, value) : notReady("settingsSet"),

  chatSend: (userMessage: string, conversationId?: string): Promise<ChatTurn> =>
    api?.chatSend
      ? api.chatSend(userMessage, conversationId)
      : notReady("chatSend"),
  chatHistory: (
    conversationId?: string,
    limit?: number,
  ): Promise<StoredMessage[]> =>
    api?.chatHistory
      ? api.chatHistory(conversationId, limit)
      : notReady("chatHistory"),
  chatClear: (conversationId?: string): Promise<number> =>
    api?.chatClear ? api.chatClear(conversationId) : notReady("chatClear"),
  costSummary: (): Promise<CostSummary> =>
    api?.costSummary ? api.costSummary() : notReady("costSummary"),

  todosList: (includeDone?: boolean): Promise<Todo[]> =>
    api?.todosList ? api.todosList(includeDone) : notReady("todosList"),
  todosCreate: (draft: TodoDraft): Promise<Todo> =>
    api?.todosCreate ? api.todosCreate(draft) : notReady("todosCreate"),
  todosComplete: (id: number): Promise<Todo> =>
    api?.todosComplete ? api.todosComplete(id) : notReady("todosComplete"),
  todosUncomplete: (id: number): Promise<Todo> =>
    api?.todosUncomplete
      ? api.todosUncomplete(id)
      : notReady("todosUncomplete"),
  todosDelete: (id: number): Promise<void> =>
    api?.todosDelete ? api.todosDelete(id) : notReady("todosDelete"),

  oauthGoogleStart: (): Promise<{ connected: boolean }> =>
    api?.oauthGoogleStart
      ? api.oauthGoogleStart()
      : notReady("oauthGoogleStart"),
  oauthGoogleStatus: (): Promise<{ connected: boolean }> =>
    api?.oauthGoogleStatus
      ? api.oauthGoogleStatus()
      : notReady("oauthGoogleStatus"),
  oauthGoogleDisconnect: (): Promise<void> =>
    api?.oauthGoogleDisconnect
      ? api.oauthGoogleDisconnect()
      : notReady("oauthGoogleDisconnect"),

  calendarTodayEvents: (): Promise<StoredEventLite[]> =>
    api?.calendarTodayEvents
      ? api.calendarTodayEvents()
      : notReady("calendarTodayEvents"),
  calendarUpcomingEvents: (days?: number): Promise<StoredEventLite[]> =>
    api?.calendarUpcomingEvents
      ? api.calendarUpcomingEvents(days)
      : notReady("calendarUpcomingEvents"),
  calendarSyncNow: (): Promise<SyncReport> =>
    api?.calendarSyncNow ? api.calendarSyncNow() : notReady("calendarSyncNow"),
  calendarCreateEvent: (draft: EventDraft): Promise<StoredEventLite> =>
    api?.calendarCreateEvent
      ? api.calendarCreateEvent(draft)
      : notReady("calendarCreateEvent"),
  calendarDeleteEvent: (googleEventId: string): Promise<void> =>
    api?.calendarDeleteEvent
      ? api.calendarDeleteEvent(googleEventId)
      : notReady("calendarDeleteEvent"),

  briefingToday: (): Promise<BriefingPayload | null> =>
    api?.briefingToday ? api.briefingToday() : notReady("briefingToday"),
  briefingRun: (force?: boolean): Promise<BriefingPayload> =>
    api?.briefingRun ? api.briefingRun(force) : notReady("briefingRun"),

  sttTranscribe: (audioB64: string, mime: string): Promise<TranscribeOutput> =>
    api?.sttTranscribe
      ? api.sttTranscribe(audioB64, mime)
      : notReady("sttTranscribe"),
  ttsSpeak: (text: string, voice?: string): Promise<SpeakOutput> =>
    api?.ttsSpeak ? api.ttsSpeak(text, voice) : notReady("ttsSpeak"),

  // Window 관련: stub은 graceful no-op (UI 흐름 막지 않음)
  windowMinimize: (): Promise<void> =>
    api?.windowMinimize ? api.windowMinimize() : noop("windowMinimize"),
  windowClose: (): Promise<void> =>
    api?.windowClose ? api.windowClose() : noop("windowClose"),
  windowStartDragging: (): Promise<void> =>
    api?.windowStartDragging
      ? api.windowStartDragging()
      : noop("windowStartDragging"),
  windowStopDragging: (): Promise<void> =>
    api?.windowStopDragging
      ? api.windowStopDragging()
      : noop("windowStopDragging"),
  windowApplyPanelState: (state: { open: boolean }): Promise<void> =>
    api?.windowApplyPanelState
      ? api.windowApplyPanelState(state)
      : noop("windowApplyPanelState"),

  // 이벤트 구독
  on: (event: string, cb: (data: unknown) => void): (() => void) =>
    api?.on ? api.on(event, cb) : () => {},
};

export default paApi;
