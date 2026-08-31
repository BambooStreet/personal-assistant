import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** 팝업 상단 라벨. 없으면 안 그린다. */
  title?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * 패널 위에 뜨는 팝업.
 *
 * 이 창은 프레임리스 + 클릭 통과가 걸린 위젯이라 팝업 하나 띄우는 데 함정이 셋 있다.
 * 전부 여기 모아 두고 호출부는 내용만 넣는다.
 *
 * 1. **`document.body`로 포털한다.** 패널 본문은 스크롤 컨테이너라 그 안에 절대배치하면
 *    팝업이 내용과 같이 굴러간다.
 * 2. **`data-clickable="true"`가 반드시 있어야 한다.** `useClickThrough`가 커서 아래
 *    요소에 그 조상이 없으면 창을 클릭 통과 모드로 바꾼다. 포털은 PanelApp 루트 바깥이라
 *    표시를 상속받지 못해, 없으면 팝업 위에서 클릭이 창을 뚫고 desktop으로 나간다.
 * 3. **위쪽 36px(타이틀바)은 덮지 않는다.** 그 줄이 유일한 드래그 영역이고 최소화·닫기도
 *    거기 있다 — 덮으면 팝업이 떠 있는 동안 창을 못 움직인다.
 */
export function Modal({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 한글 조합 중의 ESC는 조합 취소라 팝업까지 닫으면 쓰던 글이 날아간다.
      if (e.key === "Escape" && !e.isComposing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      data-clickable="true"
      className="no-drag fixed inset-x-0 bottom-0 top-9 z-50 flex items-start justify-center overflow-hidden bg-black/40 px-4 py-6"
      // 배경을 **직접** 누른 경우에만 닫는다. 카드 쪽 stopPropagation에 기대면 클릭 도중
      // 요소가 교체될 때(폼의 입력칸이 갈리는 경우) 전파 경로가 어긋나 그대로 새어 나간다.
      // mousedown 기준이라 카드 안에서 드래그해 밖에서 떼도 안 닫힌다.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="panel-scroll max-h-full w-full rounded border border-gold-soft bg-bg-elevated pb-3.5 pl-3.5 pr-2 pt-3.5 shadow-panel">
        {title && (
          <p className="mb-2.5 text-[11px] tracking-[0.12em] text-fg-muted">
            {title}
          </p>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
