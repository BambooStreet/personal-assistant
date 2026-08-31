import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // 색은 CSS 변수(RGB 채널)로 주입 — globals.css의 :root(다크)/.light가 값을 스왑한다.
      // rgb(var(--x) / <alpha-value>) 형태라 bg-fg/60 같은 불투명도 유틸도 그대로 동작.
      colors: {
        bg: {
          DEFAULT: "rgb(var(--bg) / <alpha-value>)",
          panel: "rgb(var(--bg-panel) / <alpha-value>)",
          elevated: "rgb(var(--bg-elevated) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--fg-subtle) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
        },
        sidebar: "rgb(var(--sidebar) / <alpha-value>)",
        gold: {
          DEFAULT: "rgb(var(--gold) / <alpha-value>)",
          soft: "rgb(var(--gold-soft) / <alpha-value>)",
        },
        halo: "rgb(var(--halo) / <alpha-value>)",
        sage: "rgb(var(--sage) / <alpha-value>)",
        rose: "rgb(var(--rose) / <alpha-value>)",
        teal: "rgb(var(--teal) / <alpha-value>)",
        // 카드/구분선 실선 테두리. border-line / ring-line 등으로 사용.
        line: "rgb(var(--line) / <alpha-value>)",
        // 저불투명도 오버레이 채널(스크롤바, 토글 off 배경 등). 다크=밝은 크림,
        // 라이트=어두운 잉크 — 예전 border-white/x가 라이트에서 안 보이던 문제의 해결책.
        hairline: "rgb(var(--hairline) / <alpha-value>)",
      },
      // 디자이너 핸드오프 기준: 개인 패널은 산세리프 중심(제목·라벨 포함).
      // 라틴은 Inter, 한글은 Noto Sans KR — 둘 다 variable이라 400~700을 축 하나로 낸다.
      // 채팅 화면의 디스플레이(Cinzel/명조)와 목표 '이유'의 세리프는 그 화면을 만들 때 추가한다.
      fontFamily: {
        sans: [
          "Inter Variable",
          "Noto Sans KR Variable",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        widget: "16px",
      },
      boxShadow: {
        panel: "0 30px 70px -24px rgba(46, 36, 25, 0.45)",
      },
      keyframes: {
        "avatar-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-2px)" },
        },
        "wave-out": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.35)", opacity: "0" },
        },
        "ring-pulse-soft": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
        "avatar-shake": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "20%": { transform: "rotate(-4deg)" },
          "40%": { transform: "rotate(3deg)" },
          "60%": { transform: "rotate(-3deg)" },
          "80%": { transform: "rotate(4deg)" },
        },
        "avatar-arming": {
          "0%": { transform: "scale(1)" },
          "100%": { transform: "scale(0.94)" },
        },
      },
      animation: {
        "avatar-float": "avatar-float 4s ease-in-out infinite",
        "wave-out": "wave-out 1.4s ease-out infinite",
        "wave-out-delay": "wave-out 1.4s ease-out 0.7s infinite",
        "ring-pulse-soft": "ring-pulse-soft 1.6s ease-in-out infinite",
        "avatar-shake": "avatar-shake 360ms ease-in-out infinite",
        // arming은 mousedown 후 200ms~500ms 사이 300ms 동안만 재생.
        "avatar-arming": "avatar-arming 300ms ease-out forwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
