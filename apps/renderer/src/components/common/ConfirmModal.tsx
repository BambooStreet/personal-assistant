import { Modal } from "./Modal";

interface Props {
  message: string;
  /** 본문 아래 한 줄. 결과가 되돌리기 어려울 때 무슨 일이 일어나는지 미리 말한다. */
  detail?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 예/아니오 하나만 묻는 팝업. */
export function ConfirmModal({
  message,
  detail,
  confirmLabel = "확인",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal onClose={onCancel}>
      <p className="text-[13.5px] leading-relaxed text-fg">{message}</p>
      {detail && (
        <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{detail}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-line px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          autoFocus
          className="rounded bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-accent-fg hover:brightness-110"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
