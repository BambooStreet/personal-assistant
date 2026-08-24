// 채팅 날짜 구분선 계산. 카톡처럼 날짜가 바뀌는 지점에 줄을 긋는다.
//
// 순수 함수로 빼둔 이유: 날짜 경계는 **로컬 시각** 기준이라 UTC로 비교하면 KST 기준
// 자정 근처에서 하루가 어긋난다. 화면 없이 검증할 수 있어야 한다.

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 두 시각이 같은 **로컬** 날짜인가. 타임존 변환 없이 연·월·일만 본다. */
export function isSameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * 구분선에 쓸 날짜 문구. 올해면 연도를 생략한다 — 대부분의 대화는 올해라
 * "2026년"이 매번 붙으면 소음이다.
 */
export function dateDividerLabel(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const weekday = `${WEEKDAYS[d.getDay()]}요일`;
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${md} ${weekday}` : `${d.getFullYear()}년 ${md} ${weekday}`;
}

export type DatedListItem<T> =
  | { kind: "divider"; key: string; label: string }
  | { kind: "item"; key: string; value: T };

/**
 * 말풍선 목록 사이사이에 날짜 구분선을 끼워 넣는다.
 *
 * 스토어 타입에 묶지 않으려고 제네릭이다(`lib` → `stores` 의존을 만들지 않는다).
 * **첫 메시지 앞에도 구분선을 넣는다** — 카톡도 대화 맨 위에 날짜가 있다.
 * 입력은 이미 시간순으로 정렬돼 있다고 가정한다(스토어가 그렇게 유지한다).
 */
export function withDateDividers<T extends { id: string; ts: number }>(
  items: T[],
  now: number = Date.now(),
): DatedListItem<T>[] {
  const out: DatedListItem<T>[] = [];
  let prevTs: number | null = null;
  for (const value of items) {
    if (prevTs === null || !isSameLocalDay(prevTs, value.ts)) {
      out.push({
        kind: "divider",
        // 말풍선 id를 붙여 키 충돌을 막는다(같은 날짜가 두 번 나올 일은 없지만
        // 정렬이 깨진 입력에서도 React key가 중복되지 않게).
        key: `date-${value.id}`,
        label: dateDividerLabel(value.ts, now),
      });
    }
    out.push({ kind: "item", key: value.id, value });
    prevTs = value.ts;
  }
  return out;
}
