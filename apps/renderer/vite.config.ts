import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Electron file:// 로딩과 호환을 위해 상대 경로.
  base: "./",

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: {
      ignored: ["../../core/**"],
    },
  },
  // tfjs/speech-commands는 ESM 변환량이 커서 lazy 처리하면 첫 import에 수십 초 걸린다.
  // 사전에 한 번만 번들해두도록 강제.
  optimizeDeps: {
    include: ["@tensorflow/tfjs", "@tensorflow-models/speech-commands"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
}));
