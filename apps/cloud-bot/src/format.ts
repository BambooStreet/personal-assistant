// ChatTurn·알림 → 텔레그램 표시 문자열. 마크다운은 쓰지 않고 평문(파싱 에러 회피).

import type { ChatTurn, NotificationFired, ToolCall } from "./types";

/** 쓰기 도구 confirm 카드 제목(도구별 사람이 읽을 라벨). */
export function toolConfirmPrompt(call: ToolCall): string {
  const a = (call.arguments ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  switch (call.name) {
    case "create_todo":
      return `할 일을 추가할까요?\n• ${str("title") ?? "(제목 없음)"}`;
    case "complete_todo":
      return `이 할 일을 완료로 표시할까요? (#${a["id"] ?? "?"})`;
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

export function formatAssistantText(turn: ChatTurn): string {
  const text = (turn.assistant_text ?? "").trim();
  return text.length > 0 ? text : "(응답 없음)";
}

export function formatNotification(n: NotificationFired): string {
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
