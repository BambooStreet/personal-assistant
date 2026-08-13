// 자동 업데이트 — electron-updater(NSIS) 래퍼.
// 패키징된 빌드(remote 모드)에서 Electron 셸 + 렌더러만 갱신한다. Rust 코어는
// fly deploy로 따로 관리되므로 여기서 다루지 않는다(D-014).
// 호스팅은 GitHub Releases(public repo) — package.json build.publish 참조.
//
// 상태는 단일 이벤트 `update.status`(payload: UpdateStatus)로 렌더러에 push.
// 수동 확인/적용은 IPC(update.check / update.install)로 트리거.

import { app } from "electron";
// electron-updater는 CJS(__esModule=true)에 named export만 있고 default export가 없다.
// esModuleInterop default import는 런타임에 undefined가 되므로 named import를 써야 한다.
import { autoUpdater } from "electron-updater";

import { state } from "./state";
import { broadcast } from "./windows";

// 렌더러(Settings)와 공유하는 상태 형태. api.ts의 UpdateStatus와 일치시킬 것.
export interface UpdateStatus {
  state:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  version?: string;
  percent?: number;
  error?: string;
}

function emit(status: UpdateStatus): void {
  broadcast("update.status", status);
}

let wired = false;

/** whenReady에서 1회 호출. dev(비패키지)에서는 no-op. */
export function initUpdater(): void {
  if (!app.isPackaged) {
    // dev에서는 dev-app-update.yml이 없으면 에러만 나므로 비활성.
    return;
  }
  if (wired) return;
  wired = true;

  // 다운로드는 자동, 설치(재시작)는 사용자 확인 후 quitAndInstall로.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
  autoUpdater.on("update-available", (info) =>
    emit({ state: "available", version: info?.version }),
  );
  autoUpdater.on("update-not-available", (info) =>
    emit({ state: "not-available", version: info?.version }),
  );
  autoUpdater.on("download-progress", (p) =>
    emit({ state: "downloading", percent: Math.round(p?.percent ?? 0) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    emit({ state: "downloaded", version: info?.version }),
  );
  autoUpdater.on("error", (err) =>
    emit({ state: "error", error: String(err?.message ?? err) }),
  );

  // 시작 시 1회 자동 확인(다운로드까지). 실패는 이벤트로만 알림.
  void autoUpdater.checkForUpdates().catch((e) => {
    console.warn("[updater] 초기 확인 실패", e);
  });
}

/** Settings/트레이의 "업데이트 확인" 버튼용. */
export function checkForUpdatesManual(): void {
  if (!app.isPackaged) {
    emit({ state: "not-available" });
    return;
  }
  void autoUpdater.checkForUpdates().catch((e) => {
    emit({ state: "error", error: String(e?.message ?? e) });
  });
}

/** 다운로드 완료 후 재시작하여 설치. quitAndInstall이 app.quit()을 부르므로
 *  before-quit(index.ts)에서 코어 셧다운을 거쳐 정상 종료된다. */
export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  state.isQuitting = true;
  // isSilent=false(설치 UI 표시), isForceRunAfter=true(설치 후 재실행).
  autoUpdater.quitAndInstall(false, true);
}
