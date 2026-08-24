import type { ChatProgressPayload } from "@pa/ipc-types";

// Core의 chat.progress 신호 → 사람이 읽는 한 줄.
//
// 한 턴이 20초를 넘기는데 화면엔 점 세 개뿐이라 "느린 건지 죽은 건지" 알 수 없었다(D-023).
// 도구 이름을 그대로 노출하지 않고 무엇을 하는 중인지로 바꾼다.

const TOOL_LABELS: Record<string, string> = {
  list_todos: "할 일 찾아보는 중",
  list_today_events: "오늘 일정 확인하는 중",
  list_upcoming_events: "다가오는 일정 확인하는 중",
  list_today_overview: "오늘 정리하는 중",
  suggest_schedule: "일과 짜보는 중",
  plan_travel: "이동 시간 계산하는 중",
  search_memory: "기억 찾아보는 중",
};

/** 알 수 없는 payload면 null — 모르는 신호로 엉뚱한 문구를 띄우지 않는다. */
export function progressLabel(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const { phase, tool } = data as Partial<ChatProgressPayload>;
  if (phase === "thinking") return "생각하는 중";
  if (phase === "tool") {
    if (typeof tool !== "string") return "처리하는 중";
    return TOOL_LABELS[tool] ?? "처리하는 중";
  }
  return null;
}
