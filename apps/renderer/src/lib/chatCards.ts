// 읽기 도구 결과(ChatTurn.tool_results / history의 role="tool" 행) → 채팅 카드 모델.
//
// Core는 도구가 낸 원본 JSON을 그대로 넘기고(가공 없음), 표시용 정규화는 여기서만 한다.
// 라이브 응답(tool_results)과 히스토리 복원(role="tool" 메시지) 두 경로가 이 함수를 공유하므로
// 정규화 로직은 반드시 한 곳(여기)에만 둔다. 배경: docs/UI/chat-cards.md
//
// 검증은 손으로 쓴 가드로 한다 — `@pa/ipc-types`의 zod 스키마는 **런타임 import가 불가**
// (dist가 CJS __exportStar라 Vite가 named export를 정적 분석 못 함). 렌더러는 타입만 가져온다.
// 필드가 하나라도 어긋나면 그 항목만 조용히 빠지고 채팅은 계속 동작한다.

import type { StoredEventLite, Todo } from "@pa/ipc-types";

/** 카드가 실제로 그리는 필드만. 도구 출력 전체 스키마와 결합하지 않는다. */
export type ChatCardTodo = Pick<
  Todo,
  "id" | "title" | "due_at" | "priority" | "estimated_minutes" | "recur" | "done"
>;

export type ChatCardEvent = Pick<
  StoredEventLite,
  "summary" | "start_at" | "end_at" | "all_day" | "location"
>;

export type ChatCard =
  | { key: string; kind: "todos"; todos: ChatCardTodo[] }
  | { key: string; kind: "events"; scope: "today" | "upcoming"; events: ChatCardEvent[] };

/** ChatTurn.tool_results 형태(구버전 Core 호환을 위해 느슨하게 받는다). */
export interface ToolResultLike {
  tool_call_id?: string | null;
  name?: string | null;
  content?: string | null;
}

function parseJson(content: string | null | undefined): unknown {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    // 도구가 에러 문자열을 냈거나 JSON이 아님 → 카드 없음(텍스트 응답이 상황을 설명함).
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toTodos(value: unknown): ChatCardTodo[] {
  if (!Array.isArray(value)) return [];
  const out: ChatCardTodo[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const title = str(row.title);
    const id = num(row.id);
    // 제목과 id는 필수(키·표시에 쓰임). 나머지는 없으면 그 부분만 안 그린다.
    if (title == null || id == null) continue;
    out.push({
      id,
      title,
      due_at: str(row.due_at),
      priority: num(row.priority) ?? 0,
      estimated_minutes: num(row.estimated_minutes),
      recur: str(row.recur),
      done: row.done === true,
    });
  }
  return out;
}

function toEvents(value: unknown): ChatCardEvent[] {
  if (!Array.isArray(value)) return [];
  const out: ChatCardEvent[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const summary = str(row.summary);
    const start_at = str(row.start_at);
    // 제목과 시작 시각이 없으면 카드 행으로서 의미가 없다.
    if (summary == null || start_at == null) continue;
    out.push({
      summary,
      start_at,
      end_at: str(row.end_at) ?? start_at,
      all_day: row.all_day === true,
      location: str(row.location),
    });
  }
  return out;
}

/**
 * 도구 결과 한 건 → 카드 0~2장.
 * 빈 목록은 카드를 만들지 않는다 — "없어요" 는 assistant 텍스트가 이미 말하므로 빈 카드는 소음.
 */
function cardsForResult(name: string, value: unknown, key: string): ChatCard[] {
  switch (name) {
    case "list_todos": {
      const todos = toTodos(value);
      return todos.length > 0 ? [{ key, kind: "todos", todos }] : [];
    }
    case "list_today_events": {
      const events = toEvents(value);
      return events.length > 0 ? [{ key, kind: "events", scope: "today", events }] : [];
    }
    case "list_upcoming_events": {
      const events = toEvents(value);
      return events.length > 0 ? [{ key, kind: "events", scope: "upcoming", events }] : [];
    }
    case "list_today_overview": {
      // { todos: [...], events: [...] } — 일정 먼저, 할 일 다음(오늘을 시간순으로 읽는 순서).
      if (!isRecord(value)) return [];
      const events = toEvents(value.events);
      const todos = toTodos(value.todos);
      const out: ChatCard[] = [];
      if (events.length > 0) {
        out.push({ key: `${key}:events`, kind: "events", scope: "today", events });
      }
      if (todos.length > 0) out.push({ key: `${key}:todos`, kind: "todos", todos });
      return out;
    }
    default:
      // 카드가 없는 도구(search_memory·plan_travel·suggest_schedule 등)는 기존대로 텍스트로만.
      return [];
  }
}

/**
 * Core가 쓰기 승인 직후 합성해 붙인 "갱신된 목록" 결과인지.
 * 실제 tool_call이 아니라 history에 남지 않으므로(=재로딩 시 복원 불가) 세션에 따로 보관해야 한다.
 * 접두사는 Core의 `fresh_list_after_write`와 짝 — 한쪽만 바꾸면 카드가 조용히 사라진다.
 */
export function isSynthesizedRefresh(r: ToolResultLike): boolean {
  return (r.tool_call_id ?? "").startsWith("refresh:");
}

/** 라이브 턴(ChatTurn.tool_results) → 카드 목록. */
export function buildCards(results: ToolResultLike[] | undefined | null): ChatCard[] {
  if (!results || results.length === 0) return [];
  return results.flatMap((r, i) =>
    cardsForResult(r.name ?? "", parseJson(r.content), r.tool_call_id ?? `tr${i}`),
  );
}

/** 히스토리의 tool 메시지(role="tool") 한 건 → 카드 목록. */
export function buildCardsFromToolMessage(
  toolName: string | null,
  content: string | null,
  key: string,
): ChatCard[] {
  if (!toolName) return [];
  return cardsForResult(toolName, parseJson(content), key);
}
