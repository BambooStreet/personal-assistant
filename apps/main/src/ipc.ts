import { app, BrowserWindow, ipcMain, systemPreferences } from "electron";

import { Methods, type MethodName } from "@pa/ipc-types";

import { handleDebugWakeLog, type DebugWakeLogPayload } from "./debug-log";
import { state } from "./state";
import { checkForUpdatesManual, quitAndInstall } from "./updater";
import { broadcast, getAvatarWindow, hidePanel, showPanel } from "./windows";

// 같은 method 이름이 IPC 채널 + Core JSON-RPC 메서드 양쪽 역할.
// preload는 Methods.X로 invoke하고, 여기서 같은 값으로 ipcMain.handle을 등록한다.
export function registerIpc(): void {
  ipcMain.handle(Methods.Echo, (_e, payload: unknown) => payload);

  // Core로 그대로 forward되는 단순 핸들러. payload가 없으면 defaultPayload로 대체
  // (chat.history 등 일부 core 메서드는 빈 객체를 기대).
  function forward(method: MethodName, defaultPayload: unknown = null): void {
    ipcMain.handle(method, async (_e, payload: unknown) => {
      if (!state.core) throw new Error("core not started");
      return state.core.request(method, payload ?? defaultPayload);
    });
  }

  forward(Methods.AppHealth);
  forward(Methods.SecretDelete);
  forward(Methods.SecretStatus);
  forward(Methods.SecretStatusAll);
  forward(Methods.SettingsGet);
  forward(Methods.SettingsSet);
  forward(Methods.DailyCapGet);
  forward(Methods.DailyCapSet);
  forward(Methods.ChatHistory, {});
  forward(Methods.ChatClear, {});
  forward(Methods.CostSummary);
  forward(Methods.TodosList, {});
  forward(Methods.TodosCreate);
  forward(Methods.TodosUpdate);
  forward(Methods.TodosComplete);
  forward(Methods.TodosUncomplete);
  forward(Methods.TodosDelete);

  // goals.list는 인자가 없다 — Rust dispatch가 from_value를 아예 호출하지 않으므로
  // defaultPayload가 필요 없다.
  forward(Methods.GoalsList);
  forward(Methods.GoalsCreate);
  forward(Methods.GoalsUpdate);
  forward(Methods.GoalsDelete);
  forward(Methods.GoalsMilestoneToggle);
  forward(Methods.GoalsRoutineCreate);
  forward(Methods.GoalsRoutineUpdate);
  forward(Methods.GoalsRoutineDelete);
  forward(Methods.OauthGoogleStart);
  forward(Methods.OauthGoogleStatus);
  forward(Methods.OauthGoogleDisconnect);
  forward(Methods.CalendarToday);
  forward(Methods.CalendarUpcoming, {});
  forward(Methods.CalendarSyncNow);
  forward(Methods.CalendarCreate);
  forward(Methods.CalendarUpdate);
  forward(Methods.CalendarDelete);
  forward(Methods.ScheduleCommit);
  forward(Methods.TravelAliasList);
  forward(Methods.TravelAliasSet);
  forward(Methods.TravelAliasDelete);
  forward(Methods.TravelToday);
  forward(Methods.MemoryRemember);
  forward(Methods.MemorySearch);
  forward(Methods.BriefingToday);
  forward(Methods.BriefingRun, {});
  forward(Methods.GreetingRun, {});
  forward(Methods.SpeechSpeak);

  // Custom: secret.set은 빈 값 거부.
  ipcMain.handle(
    Methods.SecretSet,
    async (_e, payload: { slot: string; value: string }) => {
      if (!state.core) throw new Error("core not started");
      if (
        !payload ||
        typeof payload.value !== "string" ||
        payload.value.length === 0
      ) {
        throw new Error("invalid secret payload");
      }
      return state.core.request(Methods.SecretSet, payload);
    },
  );

  // Custom: chat.send 결과를 호출자 외 다른 윈도우에 fan-out (다른 store가 자기 chat 상태 갱신).
  ipcMain.handle(
    Methods.ChatSend,
    async (e, payload: { user_message: string; conversation_id?: string }) => {
      if (!state.core) throw new Error("core not started");
      const result = await state.core.request(Methods.ChatSend, payload);
      const senderId = e.sender.id;
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue;
        if (w.webContents.id === senderId) continue;
        w.webContents.send("event:chat.turnAdded", {
          user_message: payload.user_message,
          turn: result,
        });
      }
      return result;
    },
  );

  // Custom: chat.continue도 fan-out — 도구 confirm 후 LLM 마무리 응답을 다른 윈도우에 동기화.
  // turnContinued payload는 turn만 (user_message 없음).
  ipcMain.handle(
    Methods.ChatContinue,
    async (e, payload: unknown) => {
      if (!state.core) throw new Error("core not started");
      const result = await state.core.request(Methods.ChatContinue, payload);
      const senderId = e.sender.id;
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue;
        if (w.webContents.id === senderId) continue;
        w.webContents.send("event:chat.turnContinued", { turn: result });
      }
      return result;
    },
  );

  // Custom: macOS는 STT 직전에 마이크 권한을 요청.
  ipcMain.handle(
    Methods.SpeechTranscribe,
    async (_e, payload: { audio_b64: string; mime?: string }) => {
      if (!state.core) throw new Error("core not started");
      if (process.platform === "darwin") {
        try {
          await systemPreferences.askForMediaAccess("microphone");
        } catch (err) {
          console.warn("[mic] askForMediaAccess failed", err);
        }
      }
      return state.core.request(Methods.SpeechTranscribe, payload);
    },
  );

  // Window 제어 — sender의 윈도우 기준
  ipcMain.handle(Methods.WindowClose, (e) => {
    // 기본은 sender 닫기. 단 panelWindow는 close 이벤트에서 hide로 가로챔 → panel 닫기 버튼은 setPanelOpen(false) 사용 권장.
    BrowserWindow.fromWebContents(e.sender)?.close();
  });

  // sender 윈도우 최소화 — 작업표시줄로 내려가고 버튼은 유지(네이티브 restore).
  // 패널 헤더의 최소화 버튼이 사용. 닫기 버튼은 setPanelOpen(false)로 트레이 재소환 경로.
  ipcMain.handle(Methods.WindowMinimize, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });

  // sender 윈도우만 click-through 토글
  ipcMain.handle(Methods.WindowSetClickThrough, (e, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // 패널 표시/숨김. 양쪽 Renderer에 panel.openChanged 이벤트 broadcast.
  ipcMain.handle(Methods.WindowSetPanelOpen, (_e, open: boolean) => {
    if (open) showPanel();
    else hidePanel();
  });

  // 아바타 상태(idle/listening/thinking/speaking) 동기화.
  ipcMain.handle(Methods.WindowSetAvatarState, (_e, avatarState: string) => {
    broadcast("avatar.stateChanged", { state: avatarState });
  });

  // 현재 아바타 가시성 조회 — 렌더러가 마운트(또는 dev HMR 리로드) 시 초기 동기화에 사용.
  // 윈도우가 없으면 표시 상태(true)로 간주.
  ipcMain.handle(Methods.WindowGetAvatarVisible, () => {
    return getAvatarWindow()?.isVisible() ?? true;
  });

  // 범용 broadcast — renderer가 다른 윈도우에 이벤트를 보낼 때 사용.
  ipcMain.handle(
    Methods.WindowBroadcast,
    (_e, payload: { event: string; data: unknown }) => {
      broadcast(payload.event, payload.data);
    },
  );

  // Auth (원격 모드에서만 의미). state.auth가 없으면 로컬 모드 → 로그인 게이트 통과(signed_in).
  ipcMain.handle(Methods.AuthLogin, async () => {
    if (!state.auth) throw new Error("로컬 모드에서는 로그인이 필요 없습니다");
    return state.auth.login();
  });
  ipcMain.handle(Methods.AuthStatus, () => {
    // 로컬 모드(state.auth 없음): 로그인 불필요 + 온보딩은 로컬 프로비저닝용으로 유지.
    if (!state.auth) return { signedIn: true, mode: "local" as const };
    // 원격 모드: 클라우드가 이미 프로비저닝됨 → 온보딩 스킵(렌더러가 mode로 판단).
    return { ...state.auth.status(), mode: "remote" as const };
  });
  ipcMain.handle(Methods.AuthLogout, async () => {
    if (!state.auth) return;
    await state.auth.logout();
  });

  // 자동 시작. setLoginItemSettings는 Windows/macOS 지원, Linux는 no-op.
  // dev 모드에선 process.execPath가 electron.exe라서 path/args를 명시하지 않으면
  // 부팅 시 "To run a local app..." 안내만 뜨고 앱이 안 뜬다.
  // app.getAppPath()는 dev에서 entry 파일의 dist 디렉토리를 돌려주는데, 거기엔
  // package.json이 없어 Electron이 default app으로 빠지므로 entry 파일 절대경로
  // (process.argv[1])을 그대로 재현해야 한다.
  ipcMain.handle(
    Methods.AutoLaunchGet,
    () => app.getLoginItemSettings().openAtLogin,
  );
  ipcMain.handle(Methods.AutoLaunchSet, (_e, enabled: boolean) => {
    const settings: Electron.Settings = {
      openAtLogin: enabled,
      openAsHidden: false, // 시작 시 위젯 표시 (avatar 작아서 방해 적음)
    };
    if (!app.isPackaged) {
      settings.path = process.execPath;
      settings.args = process.argv.slice(1);
    }
    app.setLoginItemSettings(settings);
  });

  // wake 측정 모드용 NDJSON 텔레메트리. 스키마는 docs/DECISIONS.md D-012.
  ipcMain.handle(
    Methods.DebugWakeLog,
    (_e, payload: DebugWakeLogPayload) => handleDebugWakeLog(payload),
  );

  // 앱 버전 / 자동 업데이트 (Main 자체 처리 — electron-updater. Core forward 없음).
  // 진행 상태는 `update.status` 이벤트로 push(updater.ts).
  ipcMain.handle(Methods.AppVersion, () => app.getVersion());
  ipcMain.handle(Methods.UpdateCheck, () => checkForUpdatesManual());
  ipcMain.handle(Methods.UpdateInstall, () => quitAndInstall());
}
