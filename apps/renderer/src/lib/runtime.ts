// Renderer 전용 API 진입점. EM7-7부터는 Electron 단일 런타임이라 paApi를 그대로 re-export.
// 컴포넌트는 import 경로(`lib/runtime`) 그대로 사용.

import paApi from "./api";

export const api = paApi;
export type * from "@pa/ipc-types";
