import { create } from "zustand";

import {
  api,
  type EventDraft,
  type EventPatch,
  type StoredEventLite,
} from "../lib/api";

// 일정 탭 스토어. 오늘 일정(브리핑·다른 화면이 쓴다)과 월간 그리드가 보고 있는
// 기간을 따로 들고 있다 — 다른 달을 넘겨봐도 '오늘'은 그대로여야 한다.
// Google이 원본이라 수정·삭제는 google_event_id로만 가능하다.
interface CalendarStore {
  events: StoredEventLite[];
  loading: boolean;
  error: string | null;

  /** 월간 그리드가 보고 있는 기간의 일정. `events`(오늘)와 별개로 둔다 — 다른 달을 보고 있어도 오늘 일정은 그대로여야 한다. */
  monthEvents: StoredEventLite[];

  refreshToday: () => Promise<void>;
  loadRange: (fromIso: string, toIso: string) => Promise<void>;
  createEvent: (draft: EventDraft) => Promise<StoredEventLite | null>;
  // ⚠️ 로컬 id가 아니라 google_event_id다. 아직 동기화 안 된 일정은 그 값이 없어
  // 수정·삭제를 할 수 없다 — 호출 측에서 걸러야 한다.
  updateEvent: (googleEventId: string, patch: EventPatch) => Promise<void>;
  deleteEvent: (googleEventId: string) => Promise<void>;
}

export const useCalendarStore = create<CalendarStore>((set) => ({
  events: [],
  monthEvents: [],
  loading: false,
  error: null,

  refreshToday: async () => {
    set({ loading: true, error: null });
    try {
      const events = await api.calendarTodayEvents();
      set({ events, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  // 월간 그리드가 보고 있는 기간. 마지막 요청 범위를 기억해 쓰기 후 다시 읽는다.
  loadRange: async (fromIso, toIso) => {
    lastRange = { from: fromIso, to: toIso };
    try {
      const monthEvents = await api.calendarRange(fromIso, toIso);
      set({ monthEvents, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createEvent: async (draft) => {
    try {
      const created = await api.calendarCreateEvent(draft);
      await reloadAll(set);
      return created;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  updateEvent: async (googleEventId, patch) => {
    try {
      await api.calendarUpdateEvent(googleEventId, patch);
      await reloadAll(set);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteEvent: async (googleEventId) => {
    try {
      await api.calendarDeleteEvent(googleEventId);
      await reloadAll(set);
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));

/** 마지막으로 조회한 월 범위. 쓰기 후 그 범위를 다시 읽어야 그리드가 안 어긋난다. */
let lastRange: { from: string; to: string } | null = null;

/** 쓰기 뒤 오늘 목록과 보고 있던 달을 함께 갱신한다. */
async function reloadAll(
  set: (partial: Partial<CalendarStore>) => void,
): Promise<void> {
  const events = await api.calendarTodayEvents().catch(() => null);
  if (events) set({ events });
  if (lastRange) {
    const monthEvents = await api
      .calendarRange(lastRange.from, lastRange.to)
      .catch(() => null);
    if (monthEvents) set({ monthEvents });
  }
}
