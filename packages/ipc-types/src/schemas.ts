import { z } from "zod";

// ===== Settings / Secrets =====

export const SecretSlotSchema = z.enum([
  "openai_api_key",
  "google_client_id",
  "google_client_secret",
]);
export type SecretSlot = z.infer<typeof SecretSlotSchema>;

export const SecretStatusSchema = z.object({
  slot: z.string(),
  is_set: z.boolean(),
  preview: z.string().nullable(),
});
export type SecretStatus = z.infer<typeof SecretStatusSchema>;

export const AppHealthSchema = z.object({
  db_ok: z.boolean(),
  version: z.string(),
});
export type AppHealth = z.infer<typeof AppHealthSchema>;

// ===== Chat =====

export const FinishReasonSchema = z.enum([
  "stop",
  "tool_calls",
  "length",
  "content_filter",
  "other",
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ChatTurnSchema = z.object({
  assistant_text: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema),
  finish_reason: FinishReasonSchema,
  input_tokens: z.number(),
  output_tokens: z.number(),
  cost_usd: z.number(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const StoredMessageSchema = z.object({
  id: z.number(),
  conversation_id: z.string(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  tool_call_id: z.string().nullable(),
  tool_name: z.string().nullable(),
  ts: z.string(),
});
export type StoredMessage = z.infer<typeof StoredMessageSchema>;

export const CostSummarySchema = z.object({
  today_usd: z.number(),
  month_usd: z.number(),
  last_7_days_usd: z.number(),
  total_calls: z.number(),
});
export type CostSummary = z.infer<typeof CostSummarySchema>;

// ===== Todos =====

export const TodoSchema = z.object({
  id: z.number(),
  title: z.string(),
  notes: z.string().nullable(),
  due_at: z.string().nullable(),
  priority: z.number(),
  done: z.boolean(),
  done_at: z.string().nullable(),
  // 반복 주기. null = 일회성, 'daily' | 'weekly' | 'monthly'.
  recur: z.string().nullable(),
  // 예상 소요시간(분). null = 미입력.
  estimated_minutes: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Todo = z.infer<typeof TodoSchema>;

export const TodoDraftSchema = z.object({
  title: z.string().min(1),
  notes: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  priority: z.number().nullable().optional(),
  recur: z.string().nullable().optional(),
  estimated_minutes: z.number().nullable().optional(),
});
export type TodoDraft = z.infer<typeof TodoDraftSchema>;

// ===== Calendar =====

export const StoredEventLiteSchema = z.object({
  id: z.number(),
  google_event_id: z.string().nullable(),
  summary: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  start_at: z.string(),
  end_at: z.string(),
  all_day: z.boolean(),
  status: z.string(),
});
export type StoredEventLite = z.infer<typeof StoredEventLiteSchema>;

export const EventDraftSchema = z.object({
  summary: z.string().min(1),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start_at: z.string(),
  end_at: z.string(),
  all_day: z.boolean().optional(),
});
export type EventDraft = z.infer<typeof EventDraftSchema>;

// 부분 수정 — 준 필드만 변경(전부 optional, google_event_id로 대상 지정).
export const EventPatchSchema = z.object({
  summary: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start_at: z.string().optional(),
  end_at: z.string().optional(),
  all_day: z.boolean().optional(),
});
export type EventPatch = z.infer<typeof EventPatchSchema>;

export const SyncReportSchema = z.object({
  fetched: z.number(),
  upserts: z.number(),
  deletions: z.number(),
  full_sync: z.boolean(),
});
export type SyncReport = z.infer<typeof SyncReportSchema>;

// ===== Briefing =====

export const BriefingPayloadSchema = z.object({
  date: z.string(),
  summary: z.string(),
  event_count: z.number(),
  todo_count: z.number(),
  created_at: z.string(),
});
export type BriefingPayload = z.infer<typeof BriefingPayloadSchema>;

// ===== Speech =====

export const TranscribeOutputSchema = z.object({
  text: z.string(),
  duration_secs: z.number(),
  cost_usd: z.number(),
});
export type TranscribeOutput = z.infer<typeof TranscribeOutputSchema>;

export const SpeakOutputSchema = z.object({
  audio_b64: z.string(),
  mime: z.string(),
  chars: z.number(),
  cost_usd: z.number(),
});
export type SpeakOutput = z.infer<typeof SpeakOutputSchema>;

// ===== Window =====

export const HitRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type HitRect = z.infer<typeof HitRectSchema>;

export const MonitorInfoSchema = z.object({
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number(), height: z.number() }),
  scaleFactor: z.number(),
});
export type MonitorInfo = z.infer<typeof MonitorInfoSchema>;
