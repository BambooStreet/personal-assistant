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

export const ShellOpenExternalPayloadSchema = z.object({
  url: z.string().url(),
});
export type ShellOpenExternalPayload = z.infer<typeof ShellOpenExternalPayloadSchema>;
