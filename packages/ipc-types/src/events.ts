import { z } from "zod";

import { SyncReportSchema, BriefingPayloadSchema } from "./schemas";

// Core/Main → Renderer 이벤트 페이로드 스키마.
// preload는 `event:${name}` 채널로 구독한다. 이름 자체는 core/main에서 emit하는 문자열.
// 런타임 검증은 현재 사용 안 함 (타입만 활용); 향후 IPC 경계에서 zod parse를 도입할 때 그대로 사용.

export const CoreReadyPayloadSchema = z.object({
  version: z.string(),
});
export type CoreReadyPayload = z.infer<typeof CoreReadyPayloadSchema>;

export const CoreCrashedPayloadSchema = z.object({
  reason: z.string(),
  willRestart: z.boolean(),
  attempt: z.number(),
});
export type CoreCrashedPayload = z.infer<typeof CoreCrashedPayloadSchema>;

export const CalendarSyncedPayloadSchema = SyncReportSchema;
export type CalendarSyncedPayload = z.infer<typeof CalendarSyncedPayloadSchema>;

export const BriefingCreatedPayloadSchema = BriefingPayloadSchema;
export type BriefingCreatedPayload = z.infer<typeof BriefingCreatedPayloadSchema>;

// 앱 시작 인사가 나갔다는 신호. Core가 `messages`에 이미 저장했으므로 렌더러는 화면 반영만 한다.
// ⚠️ PanelApp에서만 구독할 것 — broadcast는 모든 윈도우에 팬아웃하므로 아바타 윈도우도
// 받으면 말풍선이 두 번 붙는다(`routine.fired`와 같은 규칙).
export const GreetingFiredPayloadSchema = z.object({
  text: z.string(),
});
export type GreetingFiredPayload = z.infer<typeof GreetingFiredPayloadSchema>;

// 채팅 턴이 진행 중임을 알리는 신호. 한 턴이 20초 넘게 걸리는데 화면엔 점 세 개뿐이라
// 지연과 실패가 구분되지 않았다(D-023). Core가 단계마다 쏘고 렌더러가 문구로 바꾼다.
// 본문은 싣지 않는다 — 도구 이름만.
export const ChatProgressPayloadSchema = z.object({
  /** thinking = LLM 호출 중, tool = 읽기 도구 실행 중 */
  phase: z.enum(["thinking", "tool"]),
  /** phase가 "tool"일 때의 도구 이름 */
  tool: z.string().optional(),
});
export type ChatProgressPayload = z.infer<typeof ChatProgressPayloadSchema>;

export const ShellOpenExternalPayloadSchema = z.object({
  url: z.string().url(),
});
export type ShellOpenExternalPayload = z.infer<typeof ShellOpenExternalPayloadSchema>;
