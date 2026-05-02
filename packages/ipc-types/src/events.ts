import { z } from "zod";

import { SyncReportSchema, BriefingPayloadSchema } from "./schemas";

// Main → Renderer 이벤트 채널.
// preload는 `event:${name}` 형태로 구독.
export const Events = {
  CoreReady: "core.ready",
  CoreCrashed: "core.crashed",
  CalendarSynced: "calendar.synced",
  BriefingCreated: "briefing.created",
  ShellOpenExternal: "shell.openExternal",
} as const;

export type EventName = (typeof Events)[keyof typeof Events];

// 페이로드 스키마
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
