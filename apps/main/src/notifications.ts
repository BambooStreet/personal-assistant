import { Notification } from "electron";

type NotificationFiredPayload = {
  event_id?: number;
  summary?: string;
  start_at?: string;
  kind?: "1h" | "15m";
  tts_enabled?: boolean;
};

const BODY_BY_KIND: Record<string, string> = {
  "1h": "1시간 후 시작",
  "15m": "15분 후 시작",
};

export function showOsNotification(data: unknown): void {
  if (!Notification.isSupported()) {
    console.warn("[notifications] OS notifications not supported on this platform");
    return;
  }
  const payload = data as NotificationFiredPayload;
  const title = typeof payload.summary === "string" && payload.summary.length > 0
    ? payload.summary
    : "일정 알림";
  const body = (payload.kind && BODY_BY_KIND[payload.kind]) ?? "일정이 다가옵니다";
  try {
    new Notification({ title, body, silent: false }).show();
  } catch (e) {
    console.warn("[notifications] show failed", e);
  }
}
