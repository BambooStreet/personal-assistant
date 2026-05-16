// Renderer ↔ Main IPC 진입점.
// preload.ts가 contextBridge로 노출한 `window.api`를 타입 안전 래퍼로 감싼다.
// 모든 채널은 이미 등록된 상태(post-EM7) — optional 가드 없이 직접 호출.

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
    api: ElectronApi;
  }
}

interface ElectronApi {
  // 정적 런타임 정보 (wake telemetry session record용)
  versions: { electron: string; node: string; chrome: string };
  platform: { os: string; arch: string };

  // bootstrap
  echo: (payload: unknown) => Promise<unknown>;
  on: (event: string, cb: (data: unknown) => void) => () => void;

  // app
  appHealth: () => Promise<AppHealth>;

  // secrets
  setSecret: (slot: SecretSlot, value: string) => Promise<void>;
  deleteSecret: (slot: SecretSlot) => Promise<void>;
  secretStatus: (slot: SecretSlot) => Promise<SecretStatus>;
  secretStatusAll: () => Promise<SecretStatus[]>;

  // settings
  dailyCapGet: () => Promise<number>;
  dailyCapSet: (value: number) => Promise<void>;
  settingsGet: (key: string) => Promise<string | null>;
  settingsSet: (key: string, value: string) => Promise<void>;

  // chat
  chatSend: (userMessage: string, conversationId?: string) => Promise<ChatTurn>;
  chatContinue: (payload: {
    conversation_id?: string;
    tool_call_id: string;
    tool_name: string;
    result?: string;
    rejected?: boolean;
  }) => Promise<ChatTurn>;
  chatHistory: (
    conversationId?: string,
    limit?: number,
  ) => Promise<StoredMessage[]>;
  chatClear: (conversationId?: string) => Promise<number>;
  costSummary: () => Promise<CostSummary>;

  // todos
  todosList: (includeDone?: boolean) => Promise<Todo[]>;
  todosCreate: (draft: TodoDraft) => Promise<Todo>;
  todosComplete: (id: number) => Promise<Todo>;
  todosUncomplete: (id: number) => Promise<Todo>;
  todosDelete: (id: number) => Promise<void>;

  // oauth
  oauthGoogleStart: () => Promise<{ connected: boolean }>;
  oauthGoogleStatus: () => Promise<{ connected: boolean }>;
  oauthGoogleDisconnect: () => Promise<void>;

  // calendar
  calendarTodayEvents: () => Promise<StoredEventLite[]>;
  calendarUpcomingEvents: (days?: number) => Promise<StoredEventLite[]>;
  calendarSyncNow: () => Promise<SyncReport>;
  calendarCreateEvent: (draft: EventDraft) => Promise<StoredEventLite>;
  calendarDeleteEvent: (googleEventId: string) => Promise<void>;

  // memory
  memoryRemember: (payload: {
    content: string;
    tags?: string[];
    conversation_id?: string;
  }) => Promise<{
    id: number;
    content: string;
    tags: string[];
    created_at: string;
    last_used_at: string | null;
  }>;
  memorySearch: (
    query: string,
    limit?: number,
  ) => Promise<{
    memories: Array<{
      id: number;
      content: string;
      tags: string[];
      created_at: string;
      last_used_at: string | null;
    }>;
  }>;

  // briefing
  briefingToday: () => Promise<BriefingPayload | null>;
  briefingRun: (force?: boolean) => Promise<BriefingPayload>;

  // speech
  sttTranscribe: (audioB64: string, mime: string) => Promise<TranscribeOutput>;
  ttsSpeak: (text: string, voice?: string) => Promise<SpeakOutput>;

  // window. 드래그는 -webkit-app-region: drag CSS로 OS 네이티브 처리.
  windowClose: () => Promise<void>;
  windowSetClickThrough: (ignore: boolean) => Promise<void>;
  windowSetPanelOpen: (open: boolean) => Promise<void>;
  windowSetAvatarState: (state: string) => Promise<void>;
  windowBroadcast: (event: string, data: unknown) => Promise<void>;
  autoLaunchGet: () => Promise<boolean>;
  autoLaunchSet: (enabled: boolean) => Promise<void>;

  // debug telemetry — wake 측정 모드. 스키마는 docs/DECISIONS.md D-012.
  debugWakeLog: (
    payload:
      | { type: "open"; sessionId: string; record: unknown }
      | { type: "append"; sessionId: string; record: unknown }
      | { type: "close"; sessionId: string },
  ) => Promise<{ path?: string }>;
}

if (typeof window === "undefined" || !window.api) {
  throw new Error(
    "[pa] window.api 없음 — preload가 로드되지 않았거나 브라우저 환경에서 실행 중",
  );
}

export const api: ElectronApi = window.api;

export type * from "@pa/ipc-types";
