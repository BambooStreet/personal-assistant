import { defineConfig } from "vitest/config";

// vite.config.ts와 분리한다 — 저쪽은 Electron 번들 설정(tfjs prebundle, base "./" 등)이라
// 테스트엔 불필요하고, `test` 키를 넣으면 Vite의 UserConfig 타입과 부딪힌다.
export default defineConfig({
  test: {
    // node 환경이다 — jsdom은 이 프로젝트에서 부팅에만 ~48초가 걸려(Windows) 테스트를
    // 안 돌리게 만든다. 스토어 테스트에 DOM은 필요 없고, lib/api.ts가 읽는 `window.api`만
    // setup.ts가 최소 shim으로 심는다. 컴포넌트 렌더 테스트가 생기면 그때 jsdom을 다시 본다.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
