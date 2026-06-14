import type { CoreClient } from "@pa/core-rpc";

// 모듈 간 공유되는 가변 싱글톤. 라이프사이클 함수(whenReady/before-quit)가 set,
// 다른 모듈은 read 또는 트레이 같은 곳에서 set한다.
// core는 로컬(CoreSupervisor) 또는 원격(RemoteCore) — 둘 다 CoreClient.
interface AppState {
  core: CoreClient | null;
  isQuitting: boolean;
}

export const state: AppState = {
  core: null,
  isQuitting: false,
};
