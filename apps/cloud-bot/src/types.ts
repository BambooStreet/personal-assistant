// Core(chat.send/continue) 응답의 봇 사용 필드만. 전체 계약은 @pa/ipc-types.

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ChatTurn {
  assistant_text: string | null;
  tool_calls: ToolCall[];
  finish_reason: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** notification.fired 이벤트 payload(코어 services/notifications). */
export interface NotificationFired {
  user_id: number;
  event_id: number;
  summary: string;
  start_at: string;
  kind: string;
  tts_enabled: boolean;
  // kind === "leave" 전용(출발 알림)
  leave_at?: string;
  duration_min?: number;
  transfers?: number;
  mode?: string;
  from?: string;
  to?: string;
}
