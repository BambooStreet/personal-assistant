import { type MouseEvent } from "react";
import { X } from "lucide-react";

import { ChatPanel } from "../chat/ChatPanel";
import { CostPanel } from "../cost/CostPanel";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";
import { SettingsPage } from "../settings/SettingsPage";
import { TodoPanel } from "../todos/TodoPanel";
import { MicSettingsPanel } from "../voice/MicSettingsPanel";
import { VoiceSettingsPanel } from "../voice/VoiceSettingsPanel";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";
import { useUiStore, type SettingsTab } from "../../stores/useUiStore";
import { useUserSettingsStore } from "../../stores/useUserSettingsStore";

const DRAG_THRESHOLD_PX = 5;

// 헤더의 빈 영역을 드래그하면 윈도우가 따라 움직인다. 버튼/탭 등 인터랙션 요소를
// 클릭하면 드래그가 시작되지 않도록 target을 검사.
function handleHeaderMouseDown(e: MouseEvent<HTMLElement>): void {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest('button, input, textarea, select, a, [role="button"]')) {
    return;
  }
  const startX = e.clientX;
  const startY = e.clientY;
  let dragStarted = false;

  const onMove = (ev: globalThis.MouseEvent) => {
    if (dragStarted) return;
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD_PX) {
      dragStarted = true;
      window.removeEventListener("mousemove", onMove);
      void api.windowStartDragging();
    }
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (dragStarted) {
      void api.windowStopDragging();
    }
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

export function BottomPanel() {
  const mainTab = useUiStore((s) => s.mainTab);
  const setMainTab = useUiStore((s) => s.setMainTab);
  const onboardingCompleted = useUserSettingsStore((s) => s.onboardingCompleted);
  const settingsLoaded = useUserSettingsStore((s) => s.loaded);

  const onCollapse = async () => {
    await api.windowSetPanelOpen(false);
  };
  const onClose = async () => {
    await api.windowClose();
  };

  // settings 로드 전엔 빈 상태로 두고 (onboarding 깜빡임 방지), 로드 후 분기.
  const showOnboarding = settingsLoaded && !onboardingCompleted;

  return (
    <div className="panel-card flex h-full flex-col">
      <header
        onMouseDown={handleHeaderMouseDown}
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
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onCollapse}
            className="icon-btn h-6 w-6 text-[10px]"
            aria-label="패널 접기"
            title="패널 접기"
          >
            ▾
          </button>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn h-6 w-6 hover:bg-red-500/20 hover:text-red-300"
            aria-label="close"
          >
            <X size={12} />
          </button>
        </div>
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
      className={cn(
        "no-drag rounded-md px-2 py-1 text-xs transition-colors",
        active
          ? "bg-bg-elevated text-fg"
          : "text-fg-muted hover:bg-bg-elevated/60 hover:text-fg",
      )}
    >
      {label}
    </button>
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
              "no-drag rounded-md px-2 py-0.5 text-[11px] transition-colors",
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
