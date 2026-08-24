import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChatBubble } from "../../stores/useChatStore";

import { MessageBubble } from "./MessageBubble";

// 실제 렌더 결과를 본다. jsdom 없이 서버 렌더 마크업만 뽑으므로 빠르다
// (DOM 이벤트는 못 보지만, "화면에 이 글자가 나오는가"는 이걸로 충분하다).

function bubble(patch: Partial<ChatBubble> = {}): ChatBubble {
  return {
    id: "b1",
    role: "assistant",
    text: "할 일 3건이에요",
    // 2026-08-25 02:05 로컬. formatTime이 로컬 시각을 쓰므로 Date 생성자로 만든다.
    ts: new Date(2026, 7, 25, 2, 5).getTime(),
    ...patch,
  };
}

function html(b: ChatBubble, progress?: string | null): string {
  return renderToStaticMarkup(createElement(MessageBubble, { bubble: b, progress }));
}

describe("MessageBubble", () => {
  it("시각이 마크업에 실제로 나온다", () => {
    expect(html(bubble())).toContain("02:05");
  });

  it("한 자리 시/분도 0을 채운다", () => {
    const early = bubble({ ts: new Date(2026, 7, 25, 9, 7).getTime() });
    expect(html(early)).toContain("09:07");
  });

  it("유저 말풍선에도 시각이 붙는다", () => {
    expect(html(bubble({ role: "user", text: "할 일 목록" }))).toContain("02:05");
  });

  it("대기 중에는 시각 대신 진행 문구가 나온다", () => {
    const out = html(bubble({ text: "", pending: true }), "할 일 찾아보는 중");
    expect(out).toContain("할 일 찾아보는 중");
    expect(out).not.toContain("02:05");
  });

  it("진행 문구가 없으면 점만 나온다", () => {
    const out = html(bubble({ text: "", pending: true }), null);
    expect(out).toContain("animate-bounce");
    expect(out).not.toContain("02:05");
  });

  it("시각 색은 fg-muted다 — 라이트 모드 대비 때문", () => {
    expect(html(bubble())).toContain("text-fg-muted");
  });
});
