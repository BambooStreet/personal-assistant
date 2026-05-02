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
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
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
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
            {micErr}
          </p>
        </div>
      )}
      <div className="no-drag flex items-end gap-2 p-2">
        <MicButton
          disabled={disabled}
          onTranscribed={(text) => {
            setMicErr(null);
            if (!disabled) onSubmit(text);
          }}
          onError={setMicErr}
        />
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder ?? "무엇이든 물어보세요"}
          className="max-h-[120px] flex-1 resize-none rounded-md border border-white/10 bg-bg/60 px-2 py-1.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/85 text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
