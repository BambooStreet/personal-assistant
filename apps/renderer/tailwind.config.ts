import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "rgb(18 18 22 / <alpha-value>)",
          panel: "rgb(28 28 34 / <alpha-value>)",
          elevated: "rgb(38 38 46 / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(245 245 248 / <alpha-value>)",
          muted: "rgb(160 160 170 / <alpha-value>)",
          subtle: "rgb(110 110 120 / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(120 170 255 / <alpha-value>)",
        },
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
