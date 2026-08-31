import { Send } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { MicButton } from "../voice/MicButton";

interface Props {
  disabled?: boolean;
  onSubmit: (text: string) => void;
  placeholder?: string;
}

export function ChatInput({ disabled, onSubmit, placeholder }: Props) {
  const [value, setValue] = useState("");
  const [micErr, setMicErr] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // 최소 64px(빈 상태에서도 넉넉한 입력창) ~ 최대 160px(이후 내부 스크롤).
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 160)}px`;
  }, [value]);

  const submit = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSubmit(t);
    setValue("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-line bg-bg px-2 pb-2 pt-2">
      {micErr && (
        <div className="pb-1.5">
          <p className="rounded-md border border-rose/40 bg-rose/10 px-2 py-1 text-xs text-rose">
            {micErr}
          </p>
        </div>
      )}
      {/* 입력창 = 라운드 카드 + 안쪽 골드 헤어라인(채팅 카드와 같은 이중 프레임).
          포커스 시 accent 테두리. */}
      <div className="no-drag relative flex flex-col gap-1.5 rounded-[10px] border border-line bg-bg-panel p-[13px] shadow-[0_4px_16px_-10px_rgba(46,36,25,0.4)] transition-colors focus-within:border-accent/70">
        <span className="pointer-events-none absolute inset-[3px] rounded-[8px] border border-gold/[0.22]" />
        <textarea
          ref={ref}
          rows={3}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder ?? "무엇이든 물어보세요"}
          className="max-h-[160px] min-h-[56px] w-full resize-none bg-transparent px-1 py-0.5 text-sm leading-[1.5] tracking-[-0.01em] text-fg outline-none placeholder:text-fg-muted disabled:opacity-50"
        />
        {/* 버튼 행 — 마이크(좌) · 힌트+전송(우). */}
        <div className="flex items-center justify-between">
          <MicButton
            disabled={disabled}
            onTranscribed={(text) => {
              setMicErr(null);
              if (!disabled) onSubmit(text);
            }}
            onError={setMicErr}
          />
          <div className="flex items-center gap-2.5">
            <span className="hidden text-xs text-fg-muted sm:inline">
              ⏎ 전송 · ⇧⏎ 줄바꿈
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !value.trim()}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-[15px] text-sm font-semibold text-accent-fg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="send"
            >
              <Send size={14} /> 전송
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
