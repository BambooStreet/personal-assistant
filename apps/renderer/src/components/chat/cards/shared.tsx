// 채팅 카드 공통 껍데기 + 시각 포맷. 카드 종류가 늘어도 여백·테두리·헤더는 여기서만 바꾼다.
//
// 타이포는 docs/UI/README.md "타이포·밀도 규칙"을 따른다 — 섹션 제목 text-sm, 본문 text-xs.
// 읽는 텍스트는 12px 밑으로 안 내리되, 카운트 배지 같은 "메타"만 10.5~11px 허용.

import type { ReactNode } from "react";

/** 카드 한 장에 표시할 최대 행 수. 넘치면 "+N건 더"로 접는다(버블이 화면을 잡아먹지 않게). */
export const MAX_CARD_ROWS = 12;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface ShellProps {
  icon: ReactNode;
  title: string;
  count: number;
  children: ReactNode;
}

export function CardShell({ icon, title, count, children }: ShellProps) {
  return (
    // 안쪽 3px 골드 헤어라인 = 패널 껍데기와 같은 이중 프레임. 카드가 대화 흐름 안에서
    // "액자에 넣은 자료"처럼 보이게 하는 시스템의 시그니처다.
    <div className="relative select-text rounded-[10px] border border-line bg-bg-panel p-2">
      <span className="pointer-events-none absolute inset-[3px] rounded-[8px] border border-gold/[0.22]" />
      <div className="mb-1.5 flex items-center gap-2 px-2 pt-1.5">
        <span className="text-gold">{icon}</span>
        <span className="font-display text-xs font-semibold tracking-[0.1em] text-fg">
          {title}
        </span>
        <span className="rounded-full bg-halo px-2 py-0.5 text-[10.5px] font-semibold text-accent">
          {count}건
        </span>
      </div>
      {children}
    </div>
  );
}

export function MoreRow({ count }: { count: number }) {
  return <p className="pt-1 text-xs text-fg-subtle">+{count}건 더</p>;
}

/**
 * UTC(RFC3339) → 로컬 표시 라벨. Date가 OS 타임존으로 변환하므로 별도 오프셋 계산은 하지 않는다.
 * 오늘이면 'HH:MM', 올해면 'M/D(요일)', 그 밖은 'YY.M/D'.
 */
export function formatDueLabel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  if (isSameDay(d, now)) return formatTime(d);
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
  }
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const label = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
  if (isSameDay(d, now)) return `오늘 ${label}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return `내일 ${label}`;
  return label;
}

export function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 시작~종료를 'HH:MM–HH:MM'으로. 파싱 실패 시 null(호출 측에서 시간 표시를 생략). */
export function formatTimeRange(startIso: string, endIso: string): string | null {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime())) return null;
  if (Number.isNaN(e.getTime())) return formatTime(s);
  return `${formatTime(s)}–${formatTime(e)}`;
}

export function isOverdue(iso: string): boolean {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

/** 날짜별 그룹핑 키(로컬 기준 YYYY-MM-DD). UTC로 자르면 KST 새벽 일정이 전날로 붙는다. */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
