import { Notification } from "electron";

type NotificationFiredPayload = {
  event_id?: number;
  summary?: string;
  start_at?: string;
  kind?: "1h" | "15m" | "leave";
  tts_enabled?: boolean;
  // kind === "leave" 전용
  duration_min?: number;
  transfers?: number;
};

const BODY_BY_KIND: Record<string, string> = {
  "1h": "1시간 후 시작",
  "15m": "15분 후 시작",
};

// 출발 알림 본문: "지금 나가세요 · 대중교통 25분, 환승 1회". 환승 0이면 환승 표기 생략.
function leaveBody(p: NotificationFiredPayload): string {
  const parts: string[] = [];
  if (typeof p.duration_min === "number") parts.push(`대중교통 ${p.duration_min}분`);
  if (typeof p.transfers === "number" && p.transfers > 0) parts.push(`환승 ${p.transfers}회`);
  return parts.length > 0 ? `지금 나가세요 · ${parts.join(", ")}` : "지금 나가세요";
}

export function showOsNotification(data: unknown): void {
  if (!Notification.isSupported()) {
    console.warn("[notifications] OS notifications not supported on this platform");
    return;
  }
  const payload = data as NotificationFiredPayload;
  const title = typeof payload.summary === "string" && payload.summary.length > 0
    ? payload.summary
    : "일정 알림";
  const body = payload.kind === "leave"
    ? leaveBody(payload)
    : (payload.kind && BODY_BY_KIND[payload.kind]) ?? "일정이 다가옵니다";
  try {
    new Notification({ title, body, silent: false }).show();
  } catch (e) {
    console.warn("[notifications] show failed", e);
  }
}

// 루틴 알림(`routine.fired`). 일정 알림과 달리 본문을 여기서 조립하지 않는다 —
// Core가 LLM(또는 폴백)으로 완성된 한 문장을 이미 만들어 보낸다.
type RoutineFiredPayload = {
  goal_title?: string;
  message?: string;
};

export function showRoutineNotification(data: unknown): void {
  if (!Notification.isSupported()) {
    console.warn("[notifications] OS notifications not supported on this platform");
    return;
  }
  const payload = data as RoutineFiredPayload;
  const title =
    typeof payload.goal_title === "string" && payload.goal_title.length > 0
      ? payload.goal_title
      : "목표 알림";
  const body =
    typeof payload.message === "string" && payload.message.length > 0
      ? payload.message
      : "약속한 시간이에요";
  try {
    new Notification({ title, body, silent: false }).show();
  } catch (e) {
    console.warn("[notifications] routine show failed", e);
  }
}
