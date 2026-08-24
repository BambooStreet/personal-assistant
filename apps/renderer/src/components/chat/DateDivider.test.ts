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

  it("양옆에 1px 실선이 있다", () => {
    // h-px + bg-line 두 개가 날짜를 사이에 두고 늘어난다(flex-1).
    expect(html.match(/h-px flex-1 bg-line/g)).toHaveLength(2);
  });

  it("구분선으로 읽힌다", () => {
    expect(html).toContain('role="separator"');
  });
});
