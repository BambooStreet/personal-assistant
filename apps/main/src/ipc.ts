import { app, BrowserWindow, ipcMain, systemPreferences } from "electron";

import { Methods, type MethodName } from "@pa/ipc-types";

import { handleDebugWakeLog, type DebugWakeLogPayload } from "./debug-log";
import { startDragForWindow, stopDragForWindow } from "./drag";
import { state } from "./state";
import { broadcast, hidePanel, showPanel } from "./windows";

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
  forward(Methods.TodosComplete);
  forward(Methods.TodosUncomplete);
  forward(Methods.TodosDelete);
  forward(Methods.OauthGoogleStart);
  forward(Methods.OauthGoogleStatus);
  forward(Methods.OauthGoogleDisconnect);
  forward(Methods.CalendarToday);
  forward(Methods.CalendarUpcoming, {});
  forward(Methods.CalendarSyncNow);
  forward(Methods.CalendarCreate);
  forward(Methods.CalendarDelete);
  forward(Methods.MemoryRemember);
  forward(Methods.MemorySearch);
  forward(Methods.BriefingToday);
  forward(Methods.BriefingRun, {});
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

  // 범용 broadcast — renderer가 다른 윈도우에 이벤트를 보낼 때 사용.
  ipcMain.handle(
    Methods.WindowBroadcast,
    (_e, payload: { event: string; data: unknown }) => {
      broadcast(payload.event, payload.data);
    },
  );

  ipcMain.handle(Methods.WindowStartDragging, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) {
      console.warn("[drag] start: no window");
      return;
    }
    startDragForWindow(win);
  });
  ipcMain.handle(Methods.WindowStopDragging, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) stopDragForWindow(win.id);
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
}
