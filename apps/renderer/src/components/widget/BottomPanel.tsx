import { Minus, X } from "lucide-react";

import { ChatPanel } from "../chat/ChatPanel";
import { CostPanel } from "../cost/CostPanel";
import { SettingsPage } from "../settings/SettingsPage";
import { TodoPanel } from "../todos/TodoPanel";
import { MicSettingsPanel } from "../voice/MicSettingsPanel";
import { VoiceSettingsPanel } from "../voice/VoiceSettingsPanel";
import { cn } from "../../lib/cn";
import { api } from "../../lib/runtime";
import { useUiStore, type SettingsTab } from "../../stores/useUiStore";

export function BottomPanel() {
  const mainTab = useUiStore((s) => s.mainTab);
  const setMainTab = useUiStore((s) => s.setMainTab);
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);

  const onMinimize = async () => {
    await api.windowMinimize();
  };
  const onClose = async () => {
    await api.windowClose();
  };

  return (
    <div className="panel-card flex h-full flex-col">
      <header className="flex h-9 items-center justify-between border-b border-white/5 pl-2 pr-1.5">
        <nav className="flex gap-1">
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
        </nav>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            className="icon-btn h-6 w-6 text-[10px]"
            aria-label="패널 접기"
            title="패널 접기"
          >
            ▾
          </button>
          <button
            type="button"
            onClick={onMinimize}
            className="icon-btn h-6 w-6"
            aria-label="minimize"
          >
            <Minus size={12} />
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
        {mainTab === "chat" ? <ChatPanel /> : <SettingsTabs />}
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
      <div className="flex-1 overflow-hidden">
        {settingsTab === "todos" && <TodoPanel />}
        {settingsTab === "cost" && <CostPanel />}
        {settingsTab === "voice" && <VoiceSettingsPanel />}
        {settingsTab === "mic" && <MicSettingsPanel />}
        {settingsTab === "api" && <SettingsPage />}
      </div>
    </div>
  );
}
