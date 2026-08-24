import { afterEach } from "vitest";

import { fakeApi, resetApi } from "./fakeApi";

// lib/api.ts가 import 시점에 window.api를 읽으므로 **그 전에** 심어야 한다.
// setupFiles는 테스트 파일보다 먼저 평가되므로 여기가 유일하게 맞는 자리다.
//
// node 환경이라 window가 없다 — 최소 shim만 세운다(DOM 전체는 필요 없고, jsdom은 느리다).
const g = globalThis as unknown as { window?: Record<string, unknown> };
g.window ??= {};
g.window.api = fakeApi;

afterEach(() => {
  resetApi();
});
