import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/cn";
import type { ChatBubble } from "../../stores/useChatStore";

import { ChatCards } from "./cards/ChatCards";

interface Props {
  bubble: ChatBubble;
  /** 대기 중일 때 점 옆에 띄울 단계 문구. 없으면 점만. */
  progress?: string | null;
}

// 24시간제 HH:MM. Intl은 로케일에 따라 자정을 "24:00"으로 내는 경우가 있어 직접 만든다.
function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 어시스턴트 아바타 — 골드 링 + 디스플레이 폰트 이니셜. 시스템의 시그니처 요소. */
function AssistantMark() {
  return (
    <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full border border-gold bg-bg-panel font-display text-xs font-semibold text-accent">
      M
    </div>
  );
}

export function MessageBubble({ bubble, progress }: Props) {
  const isUser = bubble.role === "user";
  const cards = bubble.cards ?? [];
  // 카드만 있고 텍스트가 없는 턴(드묾)에서는 빈 버블을 그리지 않는다.
  const showBubble = bubble.pending || bubble.text.trim().length > 0;

  if (isUser) {
    return (
      <div className="flex w-full flex-col items-end gap-1.5">
        {showBubble && (
          <div className="flex max-w-[70%] flex-col items-end gap-1">
            <div className="min-w-0 select-text cursor-text rounded-[10px] rounded-tr-[2px] bg-accent px-[15px] py-[11px] text-sm leading-[1.65] tracking-[-0.01em] text-accent-fg">
              <div className="prose prose-sm max-w-none break-words [&_*]:text-inherit [&_p+p]:mt-1.5 [&_p]:m-0 [&_p]:whitespace-pre-line">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {bubble.text}
                </ReactMarkdown>
              </div>
            </div>
            <span className="text-[10.5px] leading-none text-fg-muted">
              {formatTime(bubble.ts)}
            </span>
          </div>
        )}
        {cards.length > 0 && (
          <div className="w-full max-w-[92%]">
            <ChatCards cards={cards} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-start gap-1.5">
      {showBubble && (
        <div className="flex w-full gap-2.5">
          <AssistantMark />
          <div className="flex min-w-0 max-w-[82%] flex-col gap-1.5">
            {/* 이름 + 시각. 시각은 "메타" 예외로 10.5px — 본문(14px)과 크기 차이를
                내야 뒤로 물러나 보인다(docs/UI/README.md 타이포 규칙). */}
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-fg">MIYA</span>
              {!bubble.pending && (
                <span className="text-[10.5px] text-fg-muted">
                  {formatTime(bubble.ts)}
                </span>
              )}
            </div>
            <div className="min-w-0 select-text cursor-text rounded-[10px] rounded-tl-[2px] border border-line bg-bg-panel px-[15px] py-[13px] text-sm leading-[1.7] tracking-[-0.01em] text-fg">
              {bubble.pending ? (
                <span className="inline-flex items-center gap-2">
                  {/* 골드 점 3개 — 시안의 dotPulse(1.2s, 각 0.18s 지연). */}
                  <span className="inline-flex gap-1.5">
                    <span className="h-1.5 w-1.5 animate-dot-pulse rounded-full bg-gold" />
                    <span className="h-1.5 w-1.5 animate-dot-pulse rounded-full bg-gold [animation-delay:0.18s]" />
                    <span className="h-1.5 w-1.5 animate-dot-pulse rounded-full bg-gold [animation-delay:0.36s]" />
                  </span>
                  {progress && (
                    <span className="text-xs text-fg-muted">{progress}…</span>
                  )}
                </span>
              ) : (
                <div className="prose prose-sm max-w-none break-words [&_*]:text-inherit [&_p+p]:mt-1.5 [&_p]:m-0 [&_p]:whitespace-pre-line [&_strong]:font-semibold [&_strong]:text-accent">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {bubble.text}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 도구 결과 카드. 목록은 여기서 보여주고 버블 텍스트는 요약만 담는다
          (Core의 표시 지침과 한 쌍 — docs/UI/chat-cards.md).
          아바타 폭(28px) + 간격(10px)만큼 들여써서 버블과 왼쪽을 맞춘다. */}
      {cards.length > 0 && (
        <div className={cn("w-full max-w-[92%]", showBubble && "pl-[38px]")}>
          <ChatCards cards={cards} />
        </div>
      )}
    </div>
  );
}
