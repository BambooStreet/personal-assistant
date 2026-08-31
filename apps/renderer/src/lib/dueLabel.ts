/**
 * 마감 칩 문구. 오늘이면 강조(호출 측이 행 테두리까지 붉게), 일주일 안이면 D-n,
 * 그 밖은 날짜.
 *
 * 할 일 탭과 목표 상세가 같이 쓴다 — 두 곳에 복사해 두면 "D-3"과 "3일 남음"처럼
 * 표현이 갈라진다.
 */
export function dueChip(iso: string): { label: string; urgent: boolean } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: "", urgent: false };
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  if (days < 0) return { label: `${-days}일 지남`, urgent: true };
  if (days === 0) return { label: "오늘 마감", urgent: true };
  if (days <= 7) return { label: `D-${days}`, urgent: false };
  return { label: `${d.getMonth() + 1}/${d.getDate()} 마감`, urgent: false };
}
