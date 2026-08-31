import type { ReactNode } from "react";

interface Props {
  label: string;
  /** 라벨 오른쪽에 붙는 액션(추가·편집 버튼 등). */
  action?: ReactNode;
}

/**
 * 패널 안 섹션의 공통 헤더 — 대문자 느낌의 자간 넓은 라벨 + 오른쪽으로 뻗는 헤어라인.
 *
 * 디자이너 핸드오프의 "개인 패널 공통" 패턴이다(11px/600/자간 .12em + 헤어라인).
 * 일정·할 일·목표 세 탭이 같은 모양을 쓰기 때문에 여기서만 바꾼다.
 *
 * 라벨은 "메타" 크기(11px)를 쓴다 — 읽는 내용이 아니라 구획 표시다
 * (docs/UI/README.md 타이포 규칙).
 */
export function SectionHeader({ label, action }: Props) {
  return (
    <div className="flex items-center gap-2.5 px-1 pb-1.5">
      <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold tracking-[0.12em] text-fg-muted">
        {label}
      </span>
      <span className="h-px flex-1 bg-line" />
      {action}
    </div>
  );
}
