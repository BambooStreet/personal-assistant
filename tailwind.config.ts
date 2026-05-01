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
    },
  },
  plugins: [],
} satisfies Config;
