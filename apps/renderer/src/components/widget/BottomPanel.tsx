import { type CSSProperties } from "react";

import { ChatPanel } from "../chat/ChatPanel";
import { CostPanel } from "../cost/CostPanel";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";
import { SettingsPage } from "../settings/SettingsPage";
import { TodoPanel } from "../todos/TodoPanel";
import { MicSettingsPanel } from "../voice/MicSettingsPanel";
import { VoiceSettingsPanel } from "../voice/VoiceSettingsPanel";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";
import {
  useUiStore,
  type CoreStatus,
  type SettingsTab,
} from "../../stores/useUiStore";
import { useUserSettingsStore } from "../../stores/useUserSettingsStore";

// 헤더 전체를 -webkit-app-region: drag로 두고 인터랙티브 자식만 no-drag로 격리.
// mousedown이 OS 네이티브 윈도우 드래그로 위임 — JS 폴링 없음.
const DRAG_STYLE = { WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as CSSProperties;

export function BottomPanel() {
  const mainTab = useUiStore((s) => s.mainTab);
  const setMainTab = useUiStore((s) => s.setMainTab);
  const coreStatus = useUiStore((s) => s.coreStatus);
  const setCoreStatus = useUiStore((s) => s.setCoreStatus);
  const onboardingCompleted = useUserSettingsStore((s) => s.onboardingCompleted);
  const settingsLoaded = useUserSettingsStore((s) => s.loaded);

  const onCollapse = async () => {
    await api.windowSetPanelOpen(false);
  };

  // settings 로드 전엔 빈 상태로 두고 (onboarding 깜빡임 방지), 로드 후 분기.
  const showOnboarding = settingsLoaded && !onboardingCompleted;

  return (
    <div className="panel-card flex h-full flex-col">
      {coreStatus && (
        <CoreStatusBanner
          status={coreStatus}
          onDismiss={() => setCoreStatus(null)}
        />
      )}
      <header
        style={DRAG_STYLE}
        className="flex h-9 cursor-grab items-center justify-between border-b border-white/5 pl-2 pr-1.5 active:cursor-grabbing"
      >
        <nav className="flex gap-1">
          {!showOnboarding && (
            <>
              <MainTabButton
                label="채팅"
                active={mainTab === "chat"}
                onClick={() => setMainTab("chat")}
              />
              <MainTabButton
                label="설정"
                active={mainTab === "settings"}
                onClick={() => setMainTab("settings")}
              />
            </>
          )}
        </nav>
        <button
          type="button"
          onClick={onCollapse}
          style={NO_DRAG_STYLE}
          className="icon-btn h-6 w-6 text-[10px]"
          aria-label="패널 접기"
          title="패널 접기"
        >
          ▾
        </button>
      </header>

      <main className="flex-1 overflow-hidden">
        {showOnboarding ? (
          <OnboardingFlow />
        ) : mainTab === "chat" ? (
          <ChatPanel />
        ) : (
          <SettingsTabs />
        )}
      </main>
    </div>
  );
}

function MainTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={NO_DRAG_STYLE}
      className={cn(
        "rounded-md px-2 py-1 text-xs transition-colors",
        active
          ? "bg-bg-elevated text-fg"
          : "text-fg-muted hover:bg-bg-elevated/60 hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

function CoreStatusBanner({
  status,
  onDismiss,
}: {
  status: CoreStatus;
  onDismiss: () => void;
}) {
  const isRestarting = status.kind === "restarting";
  const message = isRestarting
    ? `코어 재시작 중… (시도 ${status.attempt})`
    : "코어 프로세스가 중단되었습니다. 앱을 재시작해주세요.";
  return (
    <div
      style={NO_DRAG_STYLE}
      className={cn(
        "flex items-center justify-between border-b px-2 py-1 text-[11px]",
        isRestarting
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : "border-red-500/30 bg-red-500/10 text-red-200",
      )}
      role="status"
    >
      <span className="truncate" title={status.reason}>
        {message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 shrink-0 rounded px-1 text-xs opacity-70 hover:opacity-100"
        aria-label="알림 닫기"
      >
        ✕
      </button>
    </div>
  );
}

function SettingsTabs() {
  const settingsTab = useUiStore((s) => s.settingsTab);
  const setSettingsTab = useUiStore((s) => s.setSettingsTab);

  const items: Array<{ key: SettingsTab; label: string }> = [
    { key: "todos", label: "할일" },
    { key: "cost", label: "비용" },
    { key: "voice", label: "음성" },
    { key: "mic", label: "마이크" },
    { key: "api", label: "API" },
  ];

  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 border-b border-white/5 px-2 py-1.5">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => setSettingsTab(it.key)}
            className={cn(
              "rounded-md px-2 py-0.5 text-[11px] transition-colors",
              settingsTab === it.key
                ? "bg-bg-elevated text-fg"
                : "text-fg-muted hover:bg-bg-elevated/60 hover:text-fg",
            )}
          >
            {it.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        {settingsTab === "todos" && <TodoPanel />}
        {settingsTab === "cost" && <CostPanel />}
        {settingsTab === "voice" && <VoiceSettingsPanel />}
        {settingsTab === "mic" && <MicSettingsPanel />}
        {settingsTab === "api" && <SettingsPage />}
      </div>
    </div>
  );
}
