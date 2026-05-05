import type { CoreSupervisor } from "./core/supervisor";

// 모듈 간 공유되는 가변 싱글톤. 라이프사이클 함수(whenReady/before-quit)가 set,
// 다른 모듈은 read 또는 트레이 같은 곳에서 set한다.
interface AppState {
  core: CoreSupervisor | null;
  isQuitting: boolean;
}

export const state: AppState = {
  core: null,
  isQuitting: false,
};
