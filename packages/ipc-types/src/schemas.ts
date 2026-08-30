import { z } from "zod";

// ===== Settings / Secrets =====

export const SecretSlotSchema = z.enum([
  "openai_api_key",
  "google_client_id",
  "google_client_secret",
  "kakao_rest_api_key",
  "odsay_api_key",
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

// 이번 턴에 Core가 자동 실행한 읽기 도구의 결과. content는 도구가 낸 **원본 JSON 문자열**을
// 그대로 전달한다(Core는 가공하지 않음). 렌더러가 도구명으로 분기해 카드로 렌더한다
// (`apps/renderer/src/lib/chatCards.ts`). 쓰기 도구는 여기 담기지 않음 — confirm 카드가 담당.
export const ToolResultSchema = z.object({
  tool_call_id: z.string(),
  name: z.string(),
  content: z.string(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ChatTurnSchema = z.object({
  assistant_text: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema),
  // 구버전 Core(필드 없음) 호환 — 없으면 빈 배열.
  tool_results: z.array(ToolResultSchema).default([]),
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

// ===== Goals (목표 + 루틴 알림) =====

export const GoalWhySchema = z.object({
  id: z.number(),
  goal_id: z.number(),
  text: z.string(),
  sort_order: z.number(),
});
export type GoalWhy = z.infer<typeof GoalWhySchema>;

export const GoalRoutineSchema = z.object({
  id: z.number(),
  goal_id: z.number(),
  // 로컬 벽시계 "HH:MM". Core가 저장 전에 0을 채워 정규화한다("7:00" → "07:00").
  time_hhmm: z.string(),
  // 요일 비트마스크. bit0=월 … bit6=일, 매일 = 127.
  // ⚠️ DateField의 달력(0=일)과 규약이 다르다 — 요일 UI는 LifestyleSection(0=월) 기준.
  days_mask: z.number(),
  // "매일" / "평일" / "월수금". 포맷을 렌더러가 복제하지 않도록 Core가 만들어 준다.
  days_label: z.string(),
  enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type GoalRoutine = z.infer<typeof GoalRoutineSchema>;

export const GoalDetailSchema = z.object({
  id: z.number(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  whys: z.array(GoalWhySchema),
  routines: z.array(GoalRoutineSchema),
});
export type GoalDetail = z.infer<typeof GoalDetailSchema>;

// 목표는 draft 전체 교체(todos와 동일). whys도 통째로 갈아끼운다.
export const GoalDraftSchema = z.object({
  title: z.string().min(1),
  whys: z.array(z.string()),
});
export type GoalDraft = z.infer<typeof GoalDraftSchema>;

export const RoutineDraftSchema = z.object({
  goal_id: z.number(),
  time_hhmm: z.string(),
  days_mask: z.number(),
});
export type RoutineDraft = z.infer<typeof RoutineDraftSchema>;

// 부분 수정 — 준 필드만 변경.
export const RoutinePatchSchema = z.object({
  time_hhmm: z.string().optional(),
  days_mask: z.number().optional(),
  enabled: z.boolean().optional(),
});
export type RoutinePatch = z.infer<typeof RoutinePatchSchema>;

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

// ===== Schedule (일과 자동 배치) =====

export const SchedulePlacementSchema = z.object({
  todo_id: z.number(),
  start_at: z.string(),
  end_at: z.string(),
});
export type SchedulePlacement = z.infer<typeof SchedulePlacementSchema>;

export const ScheduleCommitResultSchema = z.object({
  created: z.array(
    z.object({
      todo_id: z.number(),
      google_event_id: z.string().nullable(),
      summary: z.string(),
      start_at: z.string(),
      end_at: z.string(),
    }),
  ),
});
export type ScheduleCommitResult = z.infer<typeof ScheduleCommitResultSchema>;

export const SyncReportSchema = z.object({
  fetched: z.number(),
  upserts: z.number(),
  deletions: z.number(),
  full_sync: z.boolean(),
});
export type SyncReport = z.infer<typeof SyncReportSchema>;

// ===== Travel (이동시간/출발 알림) =====

// 장소 별칭("집"/"회사"/"학교"+커스텀). lat/lng는 사전 지오코딩 결과(없을 수 있음).
export const PlaceAliasSchema = z.object({
  alias: z.string(),
  query: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});
export type PlaceAlias = z.infer<typeof PlaceAliasSchema>;

export const PlaceAliasSetSchema = z.object({
  alias: z.string().min(1),
  query: z.string().min(1),
});
export type PlaceAliasSet = z.infer<typeof PlaceAliasSetSchema>;

export const PlaceAliasDeleteSchema = z.object({
  alias: z.string().min(1),
});
export type PlaceAliasDelete = z.infer<typeof PlaceAliasDeleteSchema>;

// 한 일정으로의 이동 구간.
export const TravelLegSchema = z.object({
  event_id: z.number(),
  summary: z.string(),
  from: z.string(),
  to: z.string(),
  start_at: z.string(),
  depart_by: z.string(),
  duration_min: z.number(),
  transfers: z.number(),
  mode: z.string(),
  route_detail: z.string(),
});
export type TravelLeg = z.infer<typeof TravelLegSchema>;

// ===== Briefing =====

export const BriefingPayloadSchema = z.object({
  date: z.string(),
  summary: z.string(),
  event_count: z.number(),
  todo_count: z.number(),
  created_at: z.string(),
  // 오늘 해당하는 목표 루틴 줄(Core가 결정론적으로 생성, LLM 아님).
  // 구버전 Core 호환 — 없으면 빈 배열. 단 렌더러는 런타임 parse를 하지 않으므로
  // 소비하는 쪽에서 `?? []`로 한 번 더 방어할 것.
  goal_lines: z.array(z.string()).default([]),
});
export type BriefingPayload = z.infer<typeof BriefingPayloadSchema>;

// ===== Greeting =====

/// 앱 시작 인사의 결과. 브리핑을 동봉하므로 부팅은 이 호출 하나로 끝난다(D-025).
export const GreetingPayloadSchema = z.object({
  // 이번 호출에서 인사가 실제로 나갔는가. 쿨다운에 걸리면 false — 이때는 전부 조용히 넘어간다.
  greeted: z.boolean(),
  text: z.string().nullable(),
  // LLM이 돌았는가. false면 폴백 문구(키 없음·네트워크 실패).
  generated: z.boolean(),
  // "first" | "again" | "overnight" | "few_days" | "long_time" | "cooldown".
  // enum이 아니라 string인 게 의도적 — 구 렌더러 + 신 Core에서 값이 늘어도 안 깨진다.
  reunion: z.string(),
  // 아침 창 밖에서 켰으면 null.
  briefing: BriefingPayloadSchema.nullable(),
  // 이번 호출에서 새로 만들어졌는가(= TTS 자동 재생 대상).
  briefing_created: z.boolean(),
});
export type GreetingPayload = z.infer<typeof GreetingPayloadSchema>;

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
