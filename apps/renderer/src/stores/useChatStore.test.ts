import { beforeEach, describe, expect, it } from "vitest";

import { stubApi } from "../test/fakeApi";

import { useChatStore } from "./useChatStore";

// 스토어 상태 전이 하네스.
//
// 이게 필요해진 계기: "할 일 목록"을 쳤는데 화면에 아무것도 안 나온 사건(D-023).
// Core는 정상 응답을 만들었고 실패는 클라이언트 구간에서 났는데, 그 구간을 검증할
// 수단이 하나도 없었다. 여기서 보는 건 **응답이 어떤 모양으로 오든 화면 상태가
// 어떻게 되는가** — 특히 사용자가 아무 단서 없이 남겨지는 경우.

interface TurnLike {
  assistant_text: string | null;
  tool_calls: unknown[];
  tool_results: { tool_call_id: string; name: string; content: string }[];
  finish_reason: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

function turn(patch: Partial<TurnLike> = {}): TurnLike {
  return {
    assistant_text: "네, 알겠어요",
    tool_calls: [],
    tool_results: [],
    finish_reason: "stop",
    input_tokens: 10,
    output_tokens: 5,
    cost_usd: 0.0001,
    ...patch,
  };
}

function resetStore(): void {
  useChatStore.setState({
    bubbles: [],
    sessionCards: null,
    sending: false,
    error: null,
    pendingTool: null,
    lastUserSource: null,
  });
}

beforeEach(resetStore);

describe("send", () => {
  it("응답 텍스트가 placeholder 자리에 들어간다", async () => {
    stubApi("chatSend", async () => turn({ assistant_text: "할 일 3건이에요" }));

    await useChatStore.getState().send("할 일 목록");

    const { bubbles, sending, error } = useChatStore.getState();
    expect(bubbles.map((b) => [b.role, b.text])).toEqual([
      ["user", "할 일 목록"],
      ["assistant", "할 일 3건이에요"],
    ]);
    expect(bubbles.some((b) => b.pending)).toBe(false);
    expect(sending).toBe(false);
    expect(error).toBeNull();
  });

  it("읽기 도구 결과는 카드로 붙는다", async () => {
    stubApi("chatSend", async () =>
      turn({
        assistant_text: "할 일 1건이에요",
        tool_results: [
          {
            tool_call_id: "c1",
            name: "list_todos",
            content: JSON.stringify([
              { id: 7, title: "논문 마무리", due_at: null, priority: 1, done: false },
            ]),
          },
        ],
      }),
    );

    await useChatStore.getState().send("할 일 목록");

    const assistant = useChatStore.getState().bubbles.at(-1);
    expect(assistant?.cards).toHaveLength(1);
    expect(assistant?.cards?.[0]).toMatchObject({ kind: "todos" });
  });

  it("실패하면 placeholder를 지우고 에러를 노출한다", async () => {
    // WS가 끊겨 pending이 reject되는 경로. 사용자에게 보일 단서는 이 error뿐이다.
    stubApi("chatSend", async () => {
      throw new Error("gateway 연결 종료 (code=1006)");
    });

    await useChatStore.getState().send("할 일 목록");

    const { bubbles, sending, error } = useChatStore.getState();
    expect(bubbles.map((b) => b.role)).toEqual(["user"]);
    expect(bubbles.some((b) => b.pending)).toBe(false);
    expect(sending).toBe(false);
    expect(error).toContain("gateway 연결 종료");
  });

  it("전송 중에는 다음 전송을 무시한다", async () => {
    let calls = 0;
    stubApi("chatSend", async () => {
      calls += 1;
      // 첫 호출이 매달려 있는 동안 두 번째 send가 들어오는 상황.
      await new Promise((r) => setTimeout(r, 10));
      return turn();
    });

    const first = useChatStore.getState().send("하나");
    const second = await useChatStore.getState().send("둘");
    await first;

    expect(second).toBeNull();
    expect(calls).toBe(1);
  });

  it("빈 응답이면 말풍선이 사라진다 — 에러도 없이", async () => {
    // ⚠️ 현재 동작을 그대로 못 박은 테스트다(고쳐진 동작이 아니다).
    // finalizeTurn은 텍스트도 카드도 없으면 placeholder를 삭제한다. 그러면 화면엔
    // 사용자 말풍선만 남고 error도 비어 있어, **실패와 침묵이 구분되지 않는다**.
    // 이 테스트는 그 구멍이 살아 있음을 드러내려고 있는 것 — 동작을 바꾸면 여기부터 깨진다.
    stubApi("chatSend", async () => turn({ assistant_text: "", tool_results: [] }));

    await useChatStore.getState().send("할 일 목록");

    const { bubbles, error } = useChatStore.getState();
    expect(bubbles.map((b) => b.role)).toEqual(["user"]);
    expect(error).toBeNull();
  });
});

describe("loadHistory", () => {
  it("DB 행을 말풍선으로 복원하고 tool 결과를 뒤따르는 응답에 붙인다", async () => {
    stubApi("chatHistory", async () => [
      { id: 1, conversation_id: "default", role: "user", content: "할 일 목록", tool_call_id: null, tool_name: null, tool_calls_json: null, ts: "2026-08-24T16:40:09Z" },
      { id: 2, conversation_id: "default", role: "assistant", content: "", tool_call_id: null, tool_name: "list_todos", tool_calls_json: "[]", ts: "2026-08-24T16:40:19Z" },
      { id: 3, conversation_id: "default", role: "tool", content: JSON.stringify([{ id: 7, title: "논문", due_at: null, priority: 0, done: false }]), tool_call_id: "c1", tool_name: "list_todos", tool_calls_json: null, ts: "2026-08-24T16:40:19Z" },
      { id: 4, conversation_id: "default", role: "assistant", content: "할 일 1건이에요", tool_call_id: null, tool_name: null, tool_calls_json: null, ts: "2026-08-24T16:40:32Z" },
    ]);

    await useChatStore.getState().loadHistory();

    const bubbles = useChatStore.getState().bubbles;
    expect(bubbles.map((b) => [b.role, b.text])).toEqual([
      ["user", "할 일 목록"],
      ["assistant", "할 일 1건이에요"],
    ]);
    // 카드는 tool 행 바로 뒤의 assistant에 붙는다.
    expect(bubbles[1].cards).toHaveLength(1);
  });

  it("세션 한정(uiOnly) 말풍선은 복원 후에도 남는다", async () => {
    // wake 호출 인사는 DB에 없다. 히스토리 로드가 그걸 날려버리면 안 된다.
    useChatStore.setState({
      bubbles: [
        { id: "ui1", role: "assistant", text: "네, 석주님", ts: Date.parse("2026-08-24T16:41:00Z"), uiOnly: true },
      ],
    });
    stubApi("chatHistory", async () => [
      { id: 1, conversation_id: "default", role: "user", content: "안녕", tool_call_id: null, tool_name: null, tool_calls_json: null, ts: "2026-08-24T16:40:00Z" },
    ]);

    await useChatStore.getState().loadHistory();

    const texts = useChatStore.getState().bubbles.map((b) => b.text);
    expect(texts).toEqual(["안녕", "네, 석주님"]);
  });

  it("조회가 실패해도 에러만 세우고 말풍선은 건드리지 않는다", async () => {
    stubApi("chatHistory", async () => {
      throw new Error("core not connected");
    });

    await useChatStore.getState().loadHistory();

    expect(useChatStore.getState().error).toContain("core not connected");
    expect(useChatStore.getState().bubbles).toEqual([]);
  });
});
