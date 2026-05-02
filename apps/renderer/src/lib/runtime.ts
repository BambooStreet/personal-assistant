// 런타임에서 Tauri vs Electron을 감지해 적절한 api를 export.
// EM6 끝에 Tauri 분기는 제거하고 lib/api.ts로 일원화.

import { paApi } from "./api";
import { api as tauriApi } from "./tauri";

const hasElectronApi =
  typeof window !== "undefined" && typeof (window as { api?: unknown }).api !== "undefined";

export const api = hasElectronApi ? paApi : tauriApi;
export const runtime: "electron" | "tauri" = hasElectronApi ? "electron" : "tauri";

// 기존 타입은 그대로 ipc-types에서 사용 권장.
// 컴포넌트가 직접 lib/tauri를 import하던 부분을 lib/runtime으로 일괄 교체.
export type * from "@pa/ipc-types";
