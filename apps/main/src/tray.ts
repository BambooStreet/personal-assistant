import { app, Menu, nativeImage, Tray } from "electron";
import path from "node:path";

import { state } from "./state";
import { checkForUpdatesManual } from "./updater";
import {
  broadcast,
  getAvatarWindow,
  hideAvatar,
  showAvatar,
  showPanel,
} from "./windows";

let trayInstance: Tray | null = null;

export function createTray(): Tray {
  const iconPath =
    process.platform === "win32"
      ? path.join(__dirname, "..", "resources", "tray.ico")
      : path.join(__dirname, "..", "resources", "tray.png");
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin") icon.setTemplateImage(true);

  const t = new Tray(icon);
  t.setToolTip("MIYA");

  const buildMenu = () => {
    const av = getAvatarWindow();
    const visible = !!av && av.isVisible();
    return Menu.buildFromTemplate([
      {
        label: visible ? "아바타 숨기기" : "아바타 보이기",
        click: () => {
          if (visible) hideAvatar();
          else showAvatar();
          t.setContextMenu(buildMenu());
        },
      },
      {
        label: "패널 열기",
        click: () => {
          // 패널은 아바타와 독립 — 숨김 상태에서도 아바타를 깨우지 않고 패널만 띄움.
          showPanel();
        },
      },
      {
        label: "설정",
        click: () => {
          broadcast("panel.openSettings", null);
          showPanel();
        },
      },
      {
        label: "업데이트 확인",
        click: () => {
          checkForUpdatesManual();
          // 진행 상태는 Settings에서 확인 가능하도록 패널을 띄운다.
          broadcast("panel.openSettings", null);
          showPanel();
        },
      },
      { type: "separator" },
      {
        label: "종료",
        click: () => {
          state.isQuitting = true;
          app.quit();
        },
      },
    ]);
  };

  t.setContextMenu(buildMenu());

  // Windows: 트레이 아이콘 클릭 = 아바타 토글
  t.on("click", () => {
    const av = getAvatarWindow();
    if (av?.isVisible()) hideAvatar();
    else showAvatar();
    t.setContextMenu(buildMenu());
  });

  trayInstance = t;
  return t;
}

export function destroyTray(): void {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}
