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
          "max-w-[85%] select-text cursor-text rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-accent/85 text-bg"
            : "bg-bg-elevated/80 text-fg",
        )}
      >
        {bubble.pending ? (
          <span className="inline-flex gap-1 text-fg-muted">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
          </span>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none break-words [&_p]:m-0 [&_p+p]:mt-1.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bubble.text}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
