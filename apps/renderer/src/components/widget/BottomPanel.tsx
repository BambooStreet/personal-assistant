import { type CSSProperties } from "react";

import { LoginScreen } from "../auth/LoginScreen";
import { ChatPanel } from "../chat/ChatPanel";
import { CostPanel } from "../cost/CostPanel";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";
import { SettingsPage } from "../settings/SettingsPage";
import { TodoPanel } from "../todos/TodoPanel";
import { cn } from "../../lib/cn";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/useAuthStore";
import { useUiStore, type CoreStatus } from "../../stores/useUiStore";
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
  const authStatus = useAuthStore((s) => s.status);
  const authMode = useAuthStore((s) => s.mode);

  // 최소화 = 작업표시줄에 버튼 유지(네이티브 restore). 닫기 = 작업표시줄에서 빠지고
  // 트레이 "패널 열기"로 재소환(setPanelOpen(false) → Main이 hide).
  const onMinimize = async () => {
    await api.windowMinimize();
  };
  const onClose = async () => {
    await api.windowSetPanelOpen(false);
  };

  // 게이트: auth(최외곽) → onboarding → 앱. unknown 동안은 빈 상태(깜빡임 방지).
  const showLogin = authStatus === "signed_out";
  // 온보딩은 로컬 모드(로컬 Core 프로비저닝)에서만. 클라우드 모드는 이미 프로비저닝됨 → 스킵.
  const showOnboarding =
    authStatus === "signed_in" &&
    authMode === "local" &&
    settingsLoaded &&
    !onboardingCompleted;
  const showTabs = authStatus === "signed_in" && !showOnboarding;

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
        className="flex h-9 cursor-grab items-center justify-between border-b border-line pl-2 pr-1.5 active:cursor-grabbing"
      >
        <nav className="flex gap-1">
          {showTabs && (
            <>
              <MainTabButton
                label="채팅"
                active={mainTab === "chat"}
                onClick={() => setMainTab("chat")}
              />
              <MainTabButton
                label="개인"
                active={mainTab === "todos"}
                onClick={() => setMainTab("todos")}
              />
              <MainTabButton
                label="비용"
                active={mainTab === "cost"}
                onClick={() => setMainTab("cost")}
              />
              <MainTabButton
                label="설정"
                active={mainTab === "settings"}
                onClick={() => setMainTab("settings")}
              />
            </>
          )}
        </nav>
        <div style={NO_DRAG_STYLE} className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onMinimize}
            className="icon-btn h-6 w-6 text-xs"
            aria-label="최소화"
            title="최소화 (작업표시줄로)"
          >
            ─
          </button>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn h-6 w-6 text-xs hover:!bg-red-500/20 hover:!text-red-200"
            aria-label="닫기"
            title="닫기 (트레이에서 다시 열기)"
          >
            ✕
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {showLogin ? (
          <LoginScreen />
        ) : !showTabs ? (
          showOnboarding ? (
            <OnboardingFlow />
          ) : null
        ) : mainTab === "chat" ? (
          <ChatPanel />
        ) : mainTab === "todos" ? (
          <TodoPanel />
        ) : mainTab === "cost" ? (
          <CostPanel />
        ) : (
          <SettingsPage />
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
        // 고운돋움은 weight가 400 하나뿐이라 활성 탭을 굵기로 못 가른다 —
        // 배경(bg-bg-elevated) + 색(text-fg) + 약간의 자간으로 위계를 준다.
        "rounded-md px-2 py-1 font-display text-sm tracking-[0.02em] transition-colors focus:outline-none focus-visible:outline-none",
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
        "flex items-center justify-between border-b px-2 py-1 text-xs",
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

