import { describe, expect, it } from "vitest";

import { progressLabel } from "./chatProgress";

describe("progressLabel", () => {
  it("단계와 도구를 사람 문구로 바꾼다", () => {
    expect(progressLabel({ phase: "thinking" })).toBe("생각하는 중");
    expect(progressLabel({ phase: "tool", tool: "list_todos" })).toBe("할 일 찾아보는 중");
  });

  it("모르는 도구는 뭉뚱그리되 문구는 낸다", () => {
    expect(progressLabel({ phase: "tool", tool: "list_dreams" })).toBe("처리하는 중");
    expect(progressLabel({ phase: "tool" })).toBe("처리하는 중");
  });

  it("모르는 신호엔 아무것도 띄우지 않는다", () => {
    // 구버전/신버전 Core가 섞여도 엉뚱한 문구가 뜨면 안 된다.
    expect(progressLabel({ phase: "warp" })).toBeNull();
    expect(progressLabel(null)).toBeNull();
    expect(progressLabel("thinking")).toBeNull();
  });
});
