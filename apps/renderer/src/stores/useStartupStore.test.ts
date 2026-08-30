import { beforeEach, describe, expect, it } from "vitest";

import { stubApi } from "../test/fakeApi";

import { useStartupStore } from "./useStartupStore";

// 부팅 시퀀스 스토어. 여기서 보는 건 **인사가 몇 번 나가는가**와
// **Core가 없거나 옛 버전일 때 부팅이 죽지 않는가**다(D-025).

function payload(patch: Record<string, unknown> = {}) {
  return {
    greeted: true,
    text: "또 봐요, 지훈님",
    generated: true,
    reunion: "again",
    briefing: null,
    briefing_created: false,
    ...patch,
  };
}

function resetStore(): void {
  useStartupStore.setState({ started: false, result: null, error: null });
}

describe("useStartupStore", () => {
  beforeEach(resetStore);

  it("greeting.run 결과를 그대로 담는다", async () => {
    const brief = {
      date: "2026-08-30",
      summary: "오늘은 발표 자료부터요",
      event_count: 1,
      todo_count: 2,
      created_at: "2026-08-30T00:00:00Z",
      goal_lines: [],
    };
    stubApi("greetingRun", async () =>
      payload({ briefing: brief, briefing_created: true }),
    );

    const res = await useStartupStore.getState().run();

    expect(res?.greeted).toBe(true);
    expect(res?.briefing?.summary).toBe("오늘은 발표 자료부터요");
    expect(res?.briefing_created).toBe(true);
    expect(useStartupStore.getState().result).toEqual(res);
  });

  // 렌더러 가드. 진짜 방어선은 Core 쿨다운이지만, 이게 뚫리면 매 리마운트마다
  // 네트워크를 때리고 TTS 비용이 두 배가 된다.
  it("두 번 불러도 IPC는 한 번만 나간다", async () => {
    let calls = 0;
    stubApi("greetingRun", async () => {
      calls += 1;
      return payload();
    });

    await useStartupStore.getState().run();
    const second = await useStartupStore.getState().run();

    expect(calls).toBe(1);
    expect(second).toBeNull();
  });

  // 구 Core에 붙으면 method-not-found로 던진다. 그때 부팅 전체가 멈추면 안 된다.
  it("greeting.run이 실패해도 error만 남기고 넘어간다", async () => {
    stubApi("greetingRun", async () => {
      throw new Error("method not found: greeting.run");
    });

    const res = await useStartupStore.getState().run();

    expect(res).toBeNull();
    expect(useStartupStore.getState().error).toContain("greeting.run");
    expect(useStartupStore.getState().result).toBeNull();
  });

  // 쿨다운에 걸린 경우 — 호출은 성공하지만 아무 일도 일어나면 안 된다.
  it("쿨다운이면 greeted=false로 조용히 끝난다", async () => {
    stubApi("greetingRun", async () =>
      payload({ greeted: false, text: null, reunion: "cooldown" }),
    );

    const res = await useStartupStore.getState().run();

    expect(res?.greeted).toBe(false);
    expect(res?.text).toBeNull();
  });
});
