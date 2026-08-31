interface Props {
  label: string;
}

/**
 * 날짜가 바뀌는 지점의 구분선. 양옆으로 사라지는 골드 그라데이션 + 가운데 날짜 라벨.
 *
 * 라벨은 디스플레이 폰트(Cinzel/나눔명조) — 한글 날짜라 실제로는 명조로 떨어진다.
 * 크기는 "메타" 예외로 11px(docs/UI/README.md 타이포 규칙).
 */
export function DateDivider({ label }: Props) {
  return (
    <div
      className="flex items-center gap-3 py-1"
      role="separator"
      aria-label={label}
    >
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-soft" />
      <span className="shrink-0 whitespace-nowrap font-display text-[11px] font-semibold leading-none tracking-[0.12em] text-fg-muted">
        {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-gold-soft to-transparent" />
    </div>
  );
}
