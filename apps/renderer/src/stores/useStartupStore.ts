import { create } from "zustand";

import { api, type GreetingPayload } from "../lib/api";

// 앱을 켤 때 한 번 도는 부팅 시퀀스. Core `greeting.run` 하나가 인사 여부(쿨다운)와
// 아침 브리핑 동봉 여부를 모두 판정해서 돌려주므로 여기서는 결과를 나눠 담기만 한다.
//
// `started`는 최적화용 가드일 뿐이다 — **진짜 방어선은 Core의 쿨다운 클레임**이다.
// 이 가드가 HMR·창 재생성으로 뚫려도 인사가 두 번 나가지 않는다.
interface StartupStore {
  started: boolean;
  result: GreetingPayload | null;
  error: string | null;

  run: () => Promise<GreetingPayload | null>;
}

export const useStartupStore = create<StartupStore>((set, get) => ({
  started: false,
  result: null,
  error: null,

  run: async () => {
    if (get().started) return null;
    set({ started: true, error: null });
    try {
      const res = await api.greetingRun();
      set({ result: res });
      return res;
    } catch (e) {
      // 구 Core에 붙으면 method-not-found로 던진다. 부팅을 막지 않고 조용히 넘어간다.
      set({ error: String(e) });
      return null;
    }
  },
}));
