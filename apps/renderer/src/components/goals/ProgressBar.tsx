import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";

interface Props {
  percent: number;
  /** 마운트 직후 0에서 채워 올린다. 산길의 선이 그려지는 것과 같은 결. */
  animateOnMount?: boolean;
  className?: string;
}

/**
 * 골드 그라데이션 진행 바. 목표 목록 카드와 상세의 이정표 헤더가 같이 쓴다.
 *
 * `animateOnMount`가 켜지면 0에서 시작해 실제 값으로 채워진다. 값을 그냥 넣으면
 * CSS transition은 "변화"가 없어 아무것도 안 하고 완성된 막대가 툭 나타난다.
 */
export function ProgressBar({ percent, animateOnMount, className }: Props) {
  const [width, setWidth] = useState(animateOnMount ? 0 : percent);

  useEffect(() => {
    if (!animateOnMount) {
      setWidth(percent);
      return;
    }
    // 프레임을 두 번 넘긴 뒤 목표치로 — 같은 프레임에 바꾸면 브라우저가 시작값(0)을
    // 그리기 전에 최종값을 보게 되어 transition이 아예 안 걸린다.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setWidth(percent));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [percent, animateOnMount]);

  return (
    <span
      className={cn(
        "block overflow-hidden rounded-full bg-bg-elevated",
        className,
      )}
    >
      <span
        className="block h-full rounded-full bg-gradient-to-r from-gold-soft to-gold transition-[width] duration-[600ms] ease-out"
        style={{ width: `${width}%` }}
      />
    </span>
  );
}
