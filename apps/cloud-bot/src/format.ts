// ChatTurn·알림 → 텔레그램 표시 문자열. 마크다운은 쓰지 않고 평문(파싱 에러 회피).

import type { ChatTurn, NotificationFired, ToolCall, ToolResult } from "./types";

/** 목록 한 건에 표시할 최대 행 수(데스크톱 카드의 MAX_CARD_ROWS와 같은 값). */
const MAX_ROWS = 12;

/** 쓰기 도구 confirm 카드 제목(도구별 사람이 읽을 라벨). */
export function toolConfirmPrompt(call: ToolCall): string {
  const a = (call.arguments ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  switch (call.name) {
    case "create_todo":
      return `할 일을 추가할까요?\n• ${str("title") ?? "(제목 없음)"}`;
    case "complete_todo":
      return `이 할 일을 완료로 표시할까요? (#${a["id"] ?? "?"})`;
    case "update_todo": {
      const bits: string[] = [];
      if (str("title")) bits.push(`제목: ${str("title")}`);
      if (str("due_at")) bits.push(`마감: ${str("due_at")}`);
      if (typeof a["priority"] === "number") bits.push(`우선순위: ${a["priority"]}`);
      const detail = bits.length > 0 ? `\n• ${bits.join("\n• ")}` : "";
      return `이 할 일을 수정할까요? (#${a["id"] ?? "?"})${detail}`;
    }
    case "delete_todo":
      return `이 할 일을 삭제할까요? (#${a["id"] ?? "?"})`;
    case "create_event":
      return `일정을 추가할까요?\n• ${str("summary") ?? "(제목 없음)"}\n• ${str("start_at") ?? ""} ~ ${str("end_at") ?? ""}`;
    case "update_event":
      return `일정을 수정할까요?\n• ${str("summary") ?? "(변경 내용 확인)"}`;
    case "delete_event":
      return `이 일정을 삭제할까요?\n• ${str("summary") ?? str("google_event_id") ?? ""}`;
    case "schedule_commit": {
      const items = Array.isArray(a["items"]) ? (a["items"] as unknown[]).length : 0;
      return `추천 일과 ${items}건을 캘린더에 넣을까요?`;
    }
    case "remember_fact":
      return `이 내용을 기억할까요?\n• ${str("content") ?? ""}`;
    default:
      return `'${call.name}' 작업을 실행할까요?`;
  }
}

/**
 * assistant 텍스트 + 읽기 도구 결과 목록.
 *
 * Core의 표시 지침은 "목록을 나열하지 말고 요약만"으로 바뀌었다(목록 렌더는 클라이언트 몫 —
 * 데스크톱은 채팅 카드, 봇은 이 포맷터). 그래서 여기서 목록을 직접 그리지 않으면 텔레그램에서는
 * 목록이 통째로 사라진다. 배경: docs/UI/chat-cards.md
 */
export function formatTurnBody(turn: ChatTurn): string {
  const text = (turn.assistant_text ?? "").trim();
  const lists = formatToolResults(turn.tool_results);
  if (lists.length === 0) return text;
  return text.length > 0 ? `${text}\n\n${lists}` : lists;
}

export function formatAssistantText(turn: ChatTurn): string {
  const body = formatTurnBody(turn);
  return body.length > 0 ? body : "(응답 없음)";
}

/** 읽기 도구 결과 → 평문 목록 블록(마크다운 없이). 대상 도구가 없으면 빈 문자열. */
export function formatToolResults(results: ToolResult[] | undefined): string {
  if (!results || results.length === 0) return "";
  const blocks: string[] = [];
  for (const r of results) {
    const value = parseJson(r.content);
    if (value == null) continue;
    switch (r.name) {
      case "list_todos":
        blocks.push(todoBlock(asArray(value)));
        break;
      case "list_today_events":
        blocks.push(eventBlock(asArray(value), "오늘 일정"));
        break;
      case "list_upcoming_events":
        blocks.push(eventBlock(asArray(value), "다가오는 일정"));
        break;
      case "list_today_overview": {
        const obj = value as Record<string, unknown>;
        blocks.push(eventBlock(asArray(obj.events), "오늘 일정"));
        blocks.push(todoBlock(asArray(obj.todos)));
        break;
      }
      default:
        break;
    }
  }
  return blocks.filter((b) => b.length > 0).join("\n\n");
}

function todoBlock(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  // 기한 있는 항목(빠른 순) → 기한 없는 항목.
  const withDue = rows
    .filter((t) => typeof t.due_at === "string")
    .sort((a, b) => Date.parse(a.due_at as string) - Date.parse(b.due_at as string));
  const withoutDue = rows.filter((t) => typeof t.due_at !== "string");
  const sorted = [...withDue, ...withoutDue];
  const lines = sorted.slice(0, MAX_ROWS).map((t) => {
    const star = typeof t.priority === "number" && t.priority >= 2 ? "★ " : "";
    const parts: string[] = [];
    if (typeof t.due_at === "string") {
      const due = formatDateLabel(t.due_at);
      if (due) parts.push(Date.parse(t.due_at) < Date.now() ? `${due} 지남` : due);
    }
    if (typeof t.estimated_minutes === "number") parts.push(`${t.estimated_minutes}분`);
    const suffix = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
    return `• ${star}${String(t.title ?? "")}${suffix}`;
  });
  const more = sorted.length > lines.length ? `\n+${sorted.length - lines.length}건 더` : "";
  return `✅ 할 일 (${rows.length}건)\n${lines.join("\n")}${more}`;
}

function eventBlock(rows: Record<string, unknown>[], title: string): string {
  if (rows.length === 0) return "";
  const sorted = [...rows].sort(
    (a, b) => Date.parse(String(a.start_at)) - Date.parse(String(b.start_at)),
  );
  const lines = sorted.slice(0, MAX_ROWS).map((e) => {
    const when = e.all_day === true ? "종일" : eventTimeRange(e);
    const loc = typeof e.location === "string" && e.location.trim().length > 0
      ? ` @${e.location.trim()}`
      : "";
    return `• ${when} ${String(e.summary ?? "")}${loc}`.trim();
  });
  const more = sorted.length > lines.length ? `\n+${sorted.length - lines.length}건 더` : "";
  return `📅 ${title} (${rows.length}건)\n${lines.join("\n")}${more}`;
}

function eventTimeRange(e: Record<string, unknown>): string {
  const start = typeof e.start_at === "string" ? formatLocalTime(e.start_at) : null;
  const end = typeof e.end_at === "string" ? formatLocalTime(e.end_at) : null;
  if (!start) return "";
  const day = typeof e.start_at === "string" ? formatDateLabel(e.start_at, true) : null;
  const range = end ? `${start}–${end}` : start;
  return day ? `${day} ${range}` : range;
}

/** 오늘이면 null(생략) 또는 'M/D'. onlyIfNotToday=true면 오늘은 날짜를 생략한다. */
function formatDateLabel(rfc3339: string, onlyIfNotToday = false): string | null {
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return onlyIfNotToday ? null : formatLocalTime(rfc3339);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((v) => v != null && typeof v === "object") as Record<string, unknown>[]) : [];
}

export function formatNotification(n: NotificationFired): string {
  if (n.kind === "leave") {
    const parts: string[] = [];
    if (typeof n.duration_min === "number") parts.push(`대중교통 ${n.duration_min}분`);
    if (typeof n.transfers === "number" && n.transfers > 0) {
      parts.push(`환승 ${n.transfers}회`);
    }
    const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    const dest = n.to ? ` → ${n.to}` : "";
    return `🚶 지금 나가세요: ${n.summary}${dest}${detail}`;
  }
  const label = n.kind === "1h" ? "1시간 후" : n.kind === "15m" ? "15분 후" : n.kind;
  const time = formatLocalTime(n.start_at);
  return `⏰ ${label} 일정: ${n.summary}${time ? ` (${time})` : ""}`;
}

function formatLocalTime(rfc3339: string): string | null {
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
