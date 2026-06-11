// 도구별 실제 실행 로직 — UI confirm 카드와 voice confirm이 공유.
// 결과는 LLM에 fed back할 JSON 문자열. 관련 store도 새로고침.

import type { EventPatch } from "@pa/ipc-types";

import { api, type ToolCall } from "../api";
import { useCalendarStore } from "../../stores/useCalendarStore";
import { useTodoStore } from "../../stores/useTodoStore";

// update_event 인자에서 실제 준 필드만 골라 EventPatch로. confirm 카드와 공유.
export function buildEventPatch(a: {
  summary?: string;
  start_at?: string;
  end_at?: string;
  description?: string;
  location?: string;
  all_day?: boolean;
}): EventPatch {
  const patch: EventPatch = {};
  if (a.summary !== undefined) patch.summary = a.summary;
  if (a.start_at !== undefined) patch.start_at = a.start_at;
  if (a.end_at !== undefined) patch.end_at = a.end_at;
  if (a.description !== undefined) patch.description = a.description;
  if (a.location !== undefined) patch.location = a.location;
  if (a.all_day !== undefined) patch.all_day = a.all_day;
  return patch;
}

export async function executeTool(call: ToolCall): Promise<string> {
  switch (call.name) {
    case "create_todo": {
      const a = call.arguments as {
        title?: string;
        notes?: string;
        due_at?: string;
        priority?: number;
        estimated_minutes?: number;
      };
      if (!a.title) throw new Error("create_todo: title 필수");
      const created = await api.todosCreate({
        title: a.title,
        notes: a.notes ?? null,
        due_at: a.due_at ?? null,
        priority: a.priority ?? null,
        estimated_minutes: a.estimated_minutes ?? null,
      });
      await useTodoStore.getState().refresh(true).catch(() => {});
      return JSON.stringify(created);
    }
    case "complete_todo": {
      const a = call.arguments as { id?: number };
      if (typeof a.id !== "number")
        throw new Error("complete_todo: id 필수");
      const updated = await api.todosComplete(a.id);
      await useTodoStore.getState().refresh(true).catch(() => {});
      return JSON.stringify(updated);
    }
    case "delete_todo": {
      const a = call.arguments as { id?: number };
      if (typeof a.id !== "number") throw new Error("delete_todo: id 필수");
      await api.todosDelete(a.id);
      await useTodoStore.getState().refresh(true).catch(() => {});
      return JSON.stringify({ ok: true, deleted_id: a.id });
    }
    case "create_event": {
      const a = call.arguments as {
        summary?: string;
        start_at?: string;
        end_at?: string;
        description?: string;
        location?: string;
        all_day?: boolean;
      };
      if (!a.summary || !a.start_at || !a.end_at) {
        throw new Error("create_event: summary/start_at/end_at 필수");
      }
      const created = await api.calendarCreateEvent({
        summary: a.summary,
        description: a.description ?? null,
        location: a.location ?? null,
        start_at: a.start_at,
        end_at: a.end_at,
        all_day: a.all_day ?? false,
      });
      return JSON.stringify(created);
    }
    case "update_event": {
      const a = call.arguments as {
        google_event_id?: string;
        summary?: string;
        start_at?: string;
        end_at?: string;
        description?: string;
        location?: string;
        all_day?: boolean;
      };
      if (!a.google_event_id)
        throw new Error("update_event: google_event_id 필수");
      const patch = buildEventPatch(a);
      if (Object.keys(patch).length === 0) {
        throw new Error("update_event: 변경할 필드가 없습니다");
      }
      const updated = await api.calendarUpdateEvent(a.google_event_id, patch);
      return JSON.stringify(updated);
    }
    case "delete_event": {
      const a = call.arguments as { google_event_id?: string };
      if (!a.google_event_id)
        throw new Error("delete_event: google_event_id 필수");
      await api.calendarDeleteEvent(a.google_event_id);
      return JSON.stringify({ ok: true, deleted_google_event_id: a.google_event_id });
    }
    case "schedule_commit": {
      const a = call.arguments as {
        items?: { todo_id: number; start_at: string; end_at: string }[];
      };
      const items = Array.isArray(a.items) ? a.items : [];
      if (items.length === 0) throw new Error("schedule_commit: items 필수");
      const r = await api.scheduleCommit(items);
      await useCalendarStore.getState().refreshToday().catch(() => {});
      return JSON.stringify(r);
    }
    case "remember_fact": {
      const a = call.arguments as { content?: string; tags?: string[] };
      if (!a.content) throw new Error("remember_fact: content 필수");
      const tags = Array.isArray(a.tags) ? a.tags : [];
      const saved = await api.memoryRemember({ content: a.content, tags });
      return JSON.stringify(saved);
    }
    default:
      throw new Error(`unknown tool: ${call.name}`);
  }
}
