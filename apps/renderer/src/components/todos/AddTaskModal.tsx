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
      className="no-drag fixed inset-x-0 bottom-0 top-9 z-50 flex items-start justify-center bg-black/40 px-4 pt-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full rounded border border-gold-soft bg-bg-elevated p-3.5 shadow-panel"
        // 카드 안쪽 클릭이 배경까지 올라가 닫히지 않게.
        onClick={(e) => e.stopPropagation()}
      >
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
