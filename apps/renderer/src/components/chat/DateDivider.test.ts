import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DateDivider } from "./DateDivider";

describe("DateDivider", () => {
  const html = renderToStaticMarkup(
    createElement(DateDivider, { label: "8월 25일 화요일" }),
  );

  it("날짜 문구가 나온다", () => {
    expect(html).toContain("8월 25일 화요일");
  });

  it("양옆에 골드 그라데이션 선이 있다", () => {
    // 날짜를 사이에 두고 좌우로 사라지는 방향이 서로 반대여야 한다 —
    // 같은 방향이면 한쪽이 날짜에서 멀어질수록 진해져 액자가 기울어 보인다.
    expect(html).toContain("from-transparent to-gold-soft");
    expect(html).toContain("from-gold-soft to-transparent");
    expect(html.match(/h-px flex-1/g)).toHaveLength(2);
  });

  it("구분선으로 읽힌다", () => {
    expect(html).toContain('role="separator"');
  });
});
