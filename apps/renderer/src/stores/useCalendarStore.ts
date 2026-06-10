import { create } from "zustand";

import { api, type EventDraft, type StoredEventLite } from "../lib/api";

// '할 일' 탭의 캘린더 섹션용 경량 스토어. 오늘 일정 조회 + 빠른 추가만 담당.
// 수정/삭제는 기존 채팅/별도 경로 유지(D: 캘린더는 Google이 원본, 여기선 읽기+추가).
interface CalendarStore {
  events: StoredEventLite[];
  loading: boolean;
  error: string | null;

  refreshToday: () => Promise<void>;
  createEvent: (draft: EventDraft) => Promise<StoredEventLite | null>;
}

export const useCalendarStore = create<CalendarStore>((set) => ({
  events: [],
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

  createEvent: async (draft) => {
    try {
      const created = await api.calendarCreateEvent(draft);
      // 생성 직후 오늘 목록 갱신(생성 일정이 오늘이면 반영).
      const events = await api.calendarTodayEvents();
      set({ events });
      return created;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
}));
