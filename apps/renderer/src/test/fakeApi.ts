// 가짜 preload(`window.api`). 스토어 테스트가 IPC 없이 돌게 한다.
//
// lib/api.ts는 **모듈 로드 시점에** `window.api`를 읽어 그대로 내보낸다
// (`export const api: ElectronApi = window.api`). 그래서 setup.ts가 테스트 파일보다
// 먼저 이 객체를 window에 심어야 한다.
//
// 스텁하지 않은 메서드를 부르면 즉시 던진다 — 조용히 undefined를 돌려주면
// "테스트가 뭘 안 건드렸는지" 모르는 채로 통과해 버린다.

type Handler = (...args: never[]) => unknown;

const handlers = new Map<string, Handler>();

/** 이 테스트에서 쓸 IPC 메서드 하나를 정의한다. */
export function stubApi(name: string, fn: Handler): void {
  handlers.set(name, fn);
}

/** 스텁 전부 제거. setup.ts가 매 테스트 뒤에 부른다. */
export function resetApi(): void {
  handlers.clear();
}

export const fakeApi = new Proxy({} as Record<string, unknown>, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== "string") return undefined;
    // await/Promise 판별이 이 객체를 thenable로 오해하지 않도록.
    if (prop === "then") return undefined;
    const handler = handlers.get(prop);
    if (handler) return handler;
    return () => {
      throw new Error(`fakeApi: '${prop}' 가 스텁되지 않았습니다`);
    };
  },
});
