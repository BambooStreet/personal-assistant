import { Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { BriefingCard } from "../briefing/BriefingCard";
import { api } from "../../lib/api";
import { withDateDividers } from "../../lib/chatDate";
import { progressLabel } from "../../lib/chatProgress";
import { useChatStore } from "../../stores/useChatStore";
import { useUiStore } from "../../stores/useUiStore";

import { ChatInput } from "./ChatInput";
import { DateDivider } from "./DateDivider";
import { MessageBubble } from "./MessageBubble";
import { ToolCallConfirmCard } from "./ToolCallConfirmCard";

export function ChatPanel() {
  const bubbles = useChatStore((s) => s.bubbles);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const pendingTool = useChatStore((s) => s.pendingTool);
  const progress = useChatStore((s) => s.progress);
  const setProgress = useChatStore((s) => s.setProgress);
  const send = useChatStore((s) => s.send);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const clear = useChatStore((s) => s.clear);

  const setAvatarState = useUiStore((s) => s.setAvatarState);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setAvatarState(sending ? "thinking" : "idle");
  }, [sending, setAvatarState]);

  // Core가 턴 단계마다 쏘는 신호를 문구로. sending이 아닐 때 온 건 스토어가 버린다.
  useEffect(() => {
    const off = api.on("chat.progress", (data) => {
      const label = progressLabel(data);
      if (label) setProgress(label);
    });
    return () => off();
  }, [setProgress]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bubbles, pendingTool]);

  const empty = bubbles.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-[18px] overflow-y-auto px-[18px] pb-2 pt-4">
        <BriefingCard />

        {empty && (
          <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
            <p className="text-xs text-fg-muted">무엇이든 편하게 물어보세요.</p>
            <p className="text-xs text-fg-subtle">
              "운동하기 추가해줘" 같은 요청도 가능해요.
            </p>
          </div>
        )}

        {!empty && (
          <div className="mb-1 flex items-center justify-end">
            <button
              type="button"
              onClick={() => void clear()}
              className="no-drag flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-muted hover:bg-bg-elevated hover:text-fg"
              aria-label="대화 비우기"
            >
              <Trash2 size={11} />
              비우기
            </button>
          </div>
        )}

        {withDateDividers(bubbles).map((row) =>
          row.kind === "divider" ? (
            <DateDivider key={row.key} label={row.label} />
          ) : (
            <MessageBubble key={row.key} bubble={row.value} progress={progress} />
          ),
        )}

        {pendingTool && (
          <div className="pt-1">
            <ToolCallConfirmCard call={pendingTool} />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-2 py-1.5 text-xs text-rose">
            {error}
          </div>
        )}
      </div>

      <ChatInput
        disabled={sending}
        onSubmit={(t) => {
          void send(t);
        }}
        placeholder={sending ? "응답 받는 중..." : "메시지 입력"}
      />
    </div>
  );
}
