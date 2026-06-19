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
    <div className="border-t border-white/5 bg-bg/40">
      {micErr && (
        <div className="px-2 pt-1.5">
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">
            {micErr}
          </p>
        </div>
      )}
      <div className="no-drag flex flex-col gap-2 p-2">
        <textarea
          ref={ref}
          rows={3}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder ?? "무엇이든 물어보세요"}
          className="max-h-[160px] min-h-[64px] w-full resize-none rounded-md border border-white/[0.15] bg-bg-elevated/70 px-2.5 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/70 disabled:opacity-50"
        />
        {/* 버튼 행 — 마이크(좌) · 전송(우)로 양끝 정렬해 밸런스. */}
        <div className="flex items-center justify-between">
          <MicButton
            disabled={disabled}
            onTranscribed={(text) => {
              setMicErr(null);
              if (!disabled) onSubmit(text);
            }}
            onError={setMicErr}
          />
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent/85 px-3 text-sm font-medium text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="send"
          >
            <Send size={14} /> 전송
          </button>
        </div>
      </div>
    </div>
  );
}
