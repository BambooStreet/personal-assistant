import { create } from "zustand";

import { api, type BriefingPayload } from "../lib/api";

// 브리핑 카드가 쓰는 상태. **스스로 만들지 않는다** — 생성 여부(아침 창·하루 한 번)는
// 전부 Core가 `greeting.run` 안에서 판정한다(D-025). 여기서는 이미 만들어진 오늘 것을
// 읽어오기만 한다(`briefing.today`는 캐시 조회라 LLM을 태우지 않는다).
//
// 예전의 `bootstrap`/`pendingAutoPlay`/`consumeAutoPlay`는 제거됐다: 아바타/패널이 별도
// React 트리라 one-shot 플래그가 창마다 따로 존재해 중복 재생을 못 막았다. 지금은 역할을
// 나눠서 막는다 — 호출과 TTS는 AvatarApp, 카드 표시는 패널.
interface BriefingStore {
  briefing: BriefingPayload | null;
  loading: boolean;
  dismissed: boolean;
  error: string | null;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  dismiss: () => void;
}

export const useBriefingStore = create<BriefingStore>((set) => ({
  briefing: null,
  loading: false,
  dismissed: false,
  error: null,

  // 오늘 것이 있으면 가져온다. 없으면(아침 창 밖에서 켠 날) 조용히 null.
  load: async () => {
    try {
      const existing = await api.briefingToday();
      if (existing) set({ briefing: existing, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // 카드의 "다시 생성". 아침 창 밖에서도 눌릴 수 있어야 하므로 창 판정이 없는
  // `briefing.run(force)`를 그대로 쓴다.
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const fresh = await api.briefingRun(true);
      set({ briefing: fresh, loading: false, dismissed: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
