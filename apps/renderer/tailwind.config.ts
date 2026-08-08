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
        },
        // 카드/구분선 실선 테두리. border-line / ring-line 등으로 사용.
        line: "rgb(var(--line) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "Inter",
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
