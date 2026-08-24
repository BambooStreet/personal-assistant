interface Props {
  label: string;
}

/** 날짜가 바뀌는 지점의 얇은 구분선. 카톡처럼 양옆 실선 + 가운데 날짜. */
export function DateDivider({ label }: Props) {
  return (
    <div className="flex items-center gap-2 py-1" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-line" />
      <span className="shrink-0 text-[10px] leading-none text-fg-muted">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
