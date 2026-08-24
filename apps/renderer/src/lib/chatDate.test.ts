import { describe, expect, it } from "vitest";

import { dateDividerLabel, isSameLocalDay, withDateDividers } from "./chatDate";

// 로컬 시각으로 Date를 만든다 — 문자열 파싱("2026-08-25")은 UTC로 해석돼
// KST에서 하루 어긋난다. 이 테스트가 잡으려는 게 정확히 그 함정이다.
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

const bubble = (id: string, ts: number) => ({ id, ts });

describe("isSameLocalDay", () => {
  it("같은 날의 자정 직후와 직전은 같은 날이다", () => {
    expect(isSameLocalDay(at(2026, 8, 25, 0, 0), at(2026, 8, 25, 23, 59))).toBe(true);
  });

  it("자정을 넘기면 다른 날이다 — 1분 차이여도", () => {
    expect(isSameLocalDay(at(2026, 8, 25, 23, 59), at(2026, 8, 26, 0, 0))).toBe(false);
  });

  it("월·연 경계도 넘긴다", () => {
    expect(isSameLocalDay(at(2026, 8, 31), at(2026, 9, 1))).toBe(false);
    expect(isSameLocalDay(at(2026, 12, 31), at(2027, 1, 1))).toBe(false);
  });
});

describe("dateDividerLabel", () => {
  it("올해면 연도를 생략한다", () => {
    expect(dateDividerLabel(at(2026, 8, 25), at(2026, 8, 25))).toBe("8월 25일 화요일");
  });

  it("다른 해면 연도를 붙인다", () => {
    expect(dateDividerLabel(at(2025, 12, 31), at(2026, 8, 25))).toBe(
      "2025년 12월 31일 수요일",
    );
  });

  it("요일이 실제 요일과 맞는다", () => {
    // 2026-08-25는 화요일, 2026-08-30은 일요일.
    expect(dateDividerLabel(at(2026, 8, 25), at(2026, 8, 25))).toContain("화요일");
    expect(dateDividerLabel(at(2026, 8, 30), at(2026, 8, 25))).toContain("일요일");
  });
});

describe("withDateDividers", () => {
  it("빈 목록엔 아무것도 넣지 않는다", () => {
    expect(withDateDividers([])).toEqual([]);
  });

  it("첫 메시지 앞에도 구분선을 넣는다", () => {
    const rows = withDateDividers([bubble("b1", at(2026, 8, 25))], at(2026, 8, 25));
    expect(rows.map((r) => r.kind)).toEqual(["divider", "item"]);
    expect(rows[0]).toMatchObject({ kind: "divider", label: "8월 25일 화요일" });
  });

  it("같은 날 메시지 사이엔 구분선이 없다", () => {
    const rows = withDateDividers(
      [
        bubble("b1", at(2026, 8, 25, 9, 0)),
        bubble("b2", at(2026, 8, 25, 14, 0)),
        bubble("b3", at(2026, 8, 25, 23, 59)),
      ],
      at(2026, 8, 25),
    );
    expect(rows.map((r) => r.kind)).toEqual(["divider", "item", "item", "item"]);
  });

  it("날짜가 바뀌는 지점마다 구분선이 들어간다", () => {
    const rows = withDateDividers(
      [
        bubble("b1", at(2026, 8, 24, 23, 59)),
        bubble("b2", at(2026, 8, 25, 0, 1)),
        bubble("b3", at(2026, 8, 26, 10, 0)),
      ],
      at(2026, 8, 26),
    );
    expect(rows.map((r) => r.kind)).toEqual([
      "divider",
      "item",
      "divider",
      "item",
      "divider",
      "item",
    ]);
    const labels = rows.filter((r) => r.kind === "divider").map((r) => r.label);
    expect(labels).toEqual(["8월 24일 월요일", "8월 25일 화요일", "8월 26일 수요일"]);
  });

  it("구분선 key가 말풍선 key와 겹치지 않는다", () => {
    const rows = withDateDividers(
      [bubble("b1", at(2026, 8, 24)), bubble("b2", at(2026, 8, 25))],
      at(2026, 8, 25),
    );
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
