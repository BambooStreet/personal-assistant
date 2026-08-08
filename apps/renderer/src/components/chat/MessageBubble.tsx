import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/cn";
import type { ChatBubble } from "../../stores/useChatStore";

interface Props {
  bubble: ChatBubble;
}

export function MessageBubble({ bubble }: Props) {
  const isUser = bubble.role === "user";
  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          // select-text: 전역 user-select:none(위젯 드래그용)을 버블에서만 풀어 복사 가능.
          "max-w-[85%] select-text cursor-text rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            // 유저: 인디고 그라디언트 + 우상단 꼬리 + 부드러운 그림자.
            ? "accent-gradient rounded-tr-[4px] text-white shadow-md shadow-accent/25"
            // 어시스턴트: elevated 카드 + 실선 테두리 + 좌상단 꼬리 + 은은한 그림자.
            : "rounded-tl-[4px] border border-line bg-bg-elevated text-fg shadow-sm",
        )}
      >
        {bubble.pending ? (
          <span className="inline-flex gap-1 text-fg-muted">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
          </span>
        ) : (
          // 색은 버블 텍스트색(text-white/text-fg)을 상속 — 라이트/다크 양쪽에서 올바른 대비.
          <div className="prose prose-sm max-w-none break-words [&_*]:text-inherit [&_p]:m-0 [&_p+p]:mt-1.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bubble.text}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
