import { useEffect } from "react";

import { api } from "./api";
import { useUserSettingsStore } from "../stores/useUserSettingsStore";

// 테마를 <html> 클래스에 반영하고, 다른 윈도우의 변경(broadcast)을 수신한다.
// 색 자체는 globals.css의 :root(다크)/.light 변수 스왑으로 처리 — 여기선 .light 토글만.
export function useTheme(): void {
  const theme = useUserSettingsStore((s) => s.theme);
  const applyThemeLocal = useUserSettingsStore((s) => s.applyThemeLocal);

  // 다른 윈도우가 테마를 바꾸면 로컬 상태만 갱신(재broadcast 없음 → 에코 루프 방지).
  useEffect(() => {
    const off = api.on("ui.themeChanged", (data) => {
      const t = (data as { theme?: unknown } | null)?.theme;
      if (t === "light" || t === "dark") applyThemeLocal(t);
    });
    return () => off();
  }, [applyThemeLocal]);

  // 상태 → DOM. 다크가 기본(클래스 없음)이라 .light만 붙였다 뗀다.
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);
}
