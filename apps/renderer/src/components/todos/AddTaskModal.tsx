import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { TodoDraft } from "../../lib/api";

import { TaskForm } from "./TaskForm";

interface Props {
  goals: { id: number; title: string }[];
  onSave: (draft: TodoDraft) => Promise<void>;
  onClose: () => void;
}

/**
 * 할 일 추가 팝업.
 *
 * `document.body`로 포털한다 — 패널 본문은 스크롤 컨테이너라 그 안에 절대배치하면
 * 내용과 같이 굴러간다.
 *
 * ⚠️ 그래서 **`data-clickable="true"`가 반드시 필요하다.** `useClickThrough`가
 * 커서 아래 요소에 그 조상이 없으면 창을 클릭 통과 모드로 바꾸는데, 포털은
 * PanelApp 루트 바깥이라 그 표시가 상속되지 않는다. 없으면 모달 위에서 클릭이
 * 창을 뚫고 desktop으로 나가 버튼이 아예 안 눌린다.
 *
 * 위쪽 36px(타이틀바 높이)은 덮지 않는다. 프레임리스 창이라 그 줄이 유일한 드래그
 * 영역이고 최소화·닫기도 거기 있다 — 모달이 덮으면 창을 못 움직인다.
 */
export function AddTaskModal({ goals, onSave, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 한글 조합 중의 ESC는 조합 취소라 모달까지 닫으면 안 된다.
      if (e.key === "Escape" && !e.isComposing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      data-clickable="true"
      className="no-drag fixed inset-x-0 bottom-0 top-9 z-50 flex items-start justify-center bg-black/40 px-4 pt-8"
      // 배경을 "직접" 누른 경우에만 닫는다. 카드 쪽에서 stopPropagation으로 막는 방식은
      // 클릭 도중 요소가 교체되면(타입 토글이 date input ↔ select를 갈아끼운다) 전파
      // 경로가 기대와 달라져 그대로 새어 나간다.
      // mousedown 기준이라 카드 안에서 드래그해 밖에서 떼도 안 닫힌다.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="w-full rounded border border-gold-soft bg-bg-elevated p-3.5 shadow-panel">
        <p className="mb-2.5 text-[11px] tracking-[0.12em] text-fg-muted">
          새 할 일
        </p>
        <TaskForm
          goals={goals}
          embedded
          onSave={onSave}
          onCancel={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}
