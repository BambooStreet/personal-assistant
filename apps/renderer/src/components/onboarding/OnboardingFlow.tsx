import { useEffect, useState } from "react";

import { api, type SecretStatus } from "../../lib/api";
import { useUserSettingsStore } from "../../stores/useUserSettingsStore";

// 첫 실행 시 표시되는 초기 설정 화면. OpenAI 키 (필수), Google 연결 (선택), 마이크 안내.
export function OnboardingFlow() {
  const completeOnboarding = useUserSettingsStore((s) => s.completeOnboarding);

  const [statuses, setStatuses] = useState<SecretStatus[]>([]);
  const [openaiInput, setOpenaiInput] = useState("");
  const [googleIdInput, setGoogleIdInput] = useState("");
  const [googleSecretInput, setGoogleSecretInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);

  const refresh = async () => {
    try {
      const [s, g] = await Promise.all([
        api.secretStatusAll(),
        api.oauthGoogleStatus().catch(() => ({ connected: false })),
      ]);
      setStatuses(s);
      setGoogleConnected(g.connected);
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const openai = statuses.find((s) => s.slot === "openai.api_key");
  const googleId = statuses.find((s) => s.slot === "google.client_id");
  const googleSecret = statuses.find((s) => s.slot === "google.client_secret");

  const saveOpenAi = async () => {
    if (!openaiInput.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.setSecret("openai_api_key", openaiInput);
      setOpenaiInput("");
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveGoogle = async () => {
    if (!googleIdInput.trim() || !googleSecretInput.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.setSecret("google_client_id", googleIdInput);
      await api.setSecret("google_client_secret", googleSecretInput);
      setGoogleIdInput("");
      setGoogleSecretInput("");
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const connectGoogle = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.oauthGoogleStart();
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await completeOnboarding();
  };

  const openaiSet = !!openai?.is_set;
  const googleReady = !!(googleId?.is_set && googleSecret?.is_set);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <header>
        <h2 className="text-base font-semibold">시작하기</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
          몇 가지 기본 설정을 마치면 채팅과 일정 비서를 사용할 수 있어요.
        </p>
      </header>

      <Step
        index={1}
        title="OpenAI API 키 (필수)"
        done={openaiSet}
        description="채팅과 음성 기능에 필요합니다. 키는 OS 키체인에만 저장됩니다."
      >
        {!openaiSet ? (
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              value={openaiInput}
              onChange={(e) => setOpenaiInput(e.target.value)}
              placeholder="sk-..."
              className="no-drag flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs outline-none focus:border-accent/60"
            />
            <button
              type="button"
              disabled={busy || !openaiInput.trim()}
              onClick={saveOpenAi}
              className="no-drag rounded-md bg-accent/80 px-2.5 py-1 text-[11px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              저장
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-emerald-300">저장됨 · {openai?.preview ?? "•••"}</p>
        )}
      </Step>

      <Step
        index={2}
        title="Google Calendar 연결 (선택)"
        done={googleConnected}
        description="일정 자동 동기화와 자연어 일정 등록에 사용됩니다. 나중에 설정에서 추가해도 됩니다."
      >
        {!googleReady ? (
          <div className="space-y-1.5">
            <input
              type="text"
              autoComplete="off"
              value={googleIdInput}
              onChange={(e) => setGoogleIdInput(e.target.value)}
              placeholder="Client ID (...apps.googleusercontent.com)"
              className="no-drag w-full rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs outline-none focus:border-accent/60"
            />
            <input
              type="password"
              autoComplete="off"
              value={googleSecretInput}
              onChange={(e) => setGoogleSecretInput(e.target.value)}
              placeholder="Client Secret (GOCSPX-...)"
              className="no-drag w-full rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs outline-none focus:border-accent/60"
            />
            <button
              type="button"
              disabled={
                busy || !googleIdInput.trim() || !googleSecretInput.trim()
              }
              onClick={saveGoogle}
              className="no-drag w-full rounded-md bg-accent/80 px-2 py-1 text-[11px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              저장
            </button>
          </div>
        ) : !googleConnected ? (
          <button
            type="button"
            disabled={busy}
            onClick={connectGoogle}
            className="no-drag w-full rounded-md bg-accent/80 px-2 py-1 text-[11px] font-medium text-bg disabled:opacity-50"
          >
            {busy ? "브라우저에서 인증 중..." : "Google 연결"}
          </button>
        ) : (
          <p className="text-[11px] text-emerald-300">연결됨</p>
        )}
      </Step>

      <Step
        index={3}
        title="마이크 권한 (선택)"
        done={false}
        description="첫 음성 입력 시 OS가 권한을 요청합니다. 거절해도 채팅은 사용 가능."
      >
        <p className="text-[11px] text-fg-subtle">바로 진행해도 괜찮아요.</p>
      </Step>

      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
          {err}
        </div>
      )}

      <div className="mt-auto flex gap-2 pt-2">
        <button
          type="button"
          onClick={finish}
          className="no-drag flex-1 rounded-md border border-white/10 px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-elevated"
        >
          나중에
        </button>
        <button
          type="button"
          disabled={!openaiSet}
          onClick={finish}
          title={openaiSet ? "" : "OpenAI 키를 먼저 저장하세요"}
          className="no-drag flex-1 rounded-md bg-accent/80 px-3 py-1.5 text-xs font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          시작하기
        </button>
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  description,
  done,
  children,
}: {
  index: number;
  title: string;
  description: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-white/5 bg-bg-elevated/60 p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${done ? "bg-emerald-500/30 text-emerald-200" : "bg-bg/60 text-fg-muted ring-1 ring-inset ring-white/10"}`}
        >
          {done ? "✓" : index}
        </span>
        <h3 className="text-xs font-medium">{title}</h3>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-fg-subtle">{description}</p>
      {children}
    </section>
  );
}
