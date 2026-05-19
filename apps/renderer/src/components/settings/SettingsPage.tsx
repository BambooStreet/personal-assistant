import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import { api, type SecretSlot, type SecretStatus } from "../../lib/api";
import { useUiStore, type SettingsTab } from "../../stores/useUiStore";
import { useUserSettingsStore } from "../../stores/useUserSettingsStore";
import { MicSettingsPanel } from "../voice/MicSettingsPanel";
import { VoiceSettingsPanel } from "../voice/VoiceSettingsPanel";

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "general", label: "일반" },
  { key: "voice", label: "음성" },
  { key: "mic", label: "마이크" },
  { key: "notifications", label: "알림" },
  { key: "connections", label: "연결" },
  { key: "developer", label: "개발자" },
];

export function SettingsPage() {
  const [statuses, setStatuses] = useState<SecretStatus[]>([]);
  const [openaiInput, setOpenaiInput] = useState("");
  const [googleIdInput, setGoogleIdInput] = useState("");
  const [googleSecretInput, setGoogleSecretInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setStatuses(await api.secretStatusAll());
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const saveSecret = async (slot: SecretSlot, value: string, clear: () => void) => {
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.setSecret(slot, value);
      clear();
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteSecret = async (slot: SecretSlot) => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteSecret(slot);
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const openai = statuses.find((s) => s.slot === "openai.api_key");
  const googleId = statuses.find((s) => s.slot === "google.client_id");
  const googleSecret = statuses.find((s) => s.slot === "google.client_secret");

  const settingsTab = useUiStore((s) => s.settingsTab);
  const setSettingsTab = useUiStore((s) => s.setSettingsTab);

  return (
    <div className="flex h-full flex-col">
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 px-2 py-1.5">
        {SETTINGS_TABS.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => setSettingsTab(it.key)}
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-[11px] transition-colors focus:outline-none focus-visible:outline-none",
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
        <div className="flex flex-col gap-2 p-3 text-sm">
          {settingsTab === "general" && (
            <>
              <UserNameField />
              <AutoLaunchToggle />
            </>
          )}

          {settingsTab === "voice" && (
            <>
              <VoiceModeToggle />
              <VoiceSettingsPanel />
            </>
          )}

          {settingsTab === "mic" && <MicSettingsPanel />}

          {settingsTab === "notifications" && <NotificationsSection />}

          {settingsTab === "connections" && (
            <>
              <section className="rounded-md border border-white/5 bg-bg-elevated/60 p-2.5">
                <SecretRow
                  label="OpenAI API Key"
                  status={openai}
                  input={openaiInput}
                  onInput={setOpenaiInput}
                  placeholder="sk-..."
                  busy={busy}
                  onSave={() =>
                    saveSecret("openai_api_key", openaiInput, () => setOpenaiInput(""))
                  }
                  onClear={() => deleteSecret("openai_api_key")}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
                  키는 OS 키체인에만 저장됩니다. 저장 후 재조회는 불가하고
                  마스킹된 미리보기만 표시됩니다.
                </p>
              </section>

              <section className="rounded-md border border-white/5 bg-bg-elevated/60 p-2.5">
                <p className="mb-2 text-xs font-medium">Google 연결</p>
                <div className="space-y-2">
                  <SecretRow
                    label="Client ID"
                    status={googleId}
                    input={googleIdInput}
                    onInput={setGoogleIdInput}
                    placeholder="...apps.googleusercontent.com"
                    busy={busy}
                    onSave={() =>
                      saveSecret("google_client_id", googleIdInput, () =>
                        setGoogleIdInput(""),
                      )
                    }
                    onClear={() => deleteSecret("google_client_id")}
                  />
                  <SecretRow
                    label="Client Secret"
                    status={googleSecret}
                    input={googleSecretInput}
                    onInput={setGoogleSecretInput}
                    placeholder="GOCSPX-..."
                    busy={busy}
                    onSave={() =>
                      saveSecret(
                        "google_client_secret",
                        googleSecretInput,
                        () => setGoogleSecretInput(""),
                      )
                    }
                    onClear={() => deleteSecret("google_client_secret")}
                  />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
                  Google Cloud Console &gt; OAuth 클라이언트 ID(데스크톱 앱)의 값을
                  입력하세요. 두 값이 모두 저장되면 연결 버튼이 활성화됩니다.
                </p>
                <GoogleConnectControls
                  ready={Boolean(googleId?.is_set && googleSecret?.is_set)}
                />
              </section>
            </>
          )}

          {settingsTab === "developer" && <WakeMeasurementToggle />}

          {err && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
              {err}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SecretRowProps {
  label: string;
  status: SecretStatus | undefined;
  input: string;
  onInput: (v: string) => void;
  placeholder: string;
  busy: boolean;
  onSave: () => void;
  onClear: () => void;
}

function SecretRow({
  label,
  status,
  input,
  onInput,
  placeholder,
  busy,
  onSave,
  onClear,
}: SecretRowProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-fg-muted">{label}</span>
        <span className="text-[11px] text-fg-subtle">
          {status?.is_set ? status.preview ?? "저장됨" : "미설정"}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder={placeholder}
          className="no-drag flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs outline-none focus:border-accent/60"
        />
        <button
          type="button"
          disabled={busy || !input.trim()}
          onClick={onSave}
          className="no-drag rounded-md bg-accent/80 px-2.5 py-1 text-[11px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          저장
        </button>
      </div>
      {status?.is_set && (
        <button
          type="button"
          onClick={onClear}
          className="no-drag mt-1 text-[11px] text-red-300 hover:text-red-200"
        >
          삭제
        </button>
      )}
    </div>
  );
}

function UserNameField() {
  const userName = useUserSettingsStore((s) => s.userName);
  const setUserName = useUserSettingsStore((s) => s.setUserName);
  const [draft, setDraft] = useState(userName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(userName);
  }, [userName]);

  const onSave = async () => {
    if (draft.trim() === userName) return;
    setBusy(true);
    try {
      await setUserName(draft);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-white/5 bg-bg-elevated/60 p-2.5">
      <p className="mb-1.5 text-xs font-medium">호칭</p>
      <p className="mb-2 text-[11px] leading-relaxed text-fg-subtle">
        음성 사이클 시작 시 "네, ○○님"으로 응답합니다.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="예: 홍길동"
          className="no-drag flex-1 rounded-md border border-white/10 bg-bg/60 px-2 py-1 text-xs outline-none focus:border-accent/60"
        />
        <button
          type="button"
          disabled={busy || draft.trim() === userName}
          onClick={onSave}
          className="no-drag rounded-md bg-accent/80 px-2.5 py-1 text-[11px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </section>
  );
}

function VoiceModeToggle() {
  const enabled = useUserSettingsStore((s) => s.voiceEnabled);
  const setEnabled = useUserSettingsStore((s) => s.setVoiceEnabled);
  const [busy, setBusy] = useState(false);

  const onToggle = async () => {
    setBusy(true);
    try {
      await setEnabled(!enabled);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-white/5 bg-bg-elevated/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">항시 마이크 청취</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            학습된 호칭을 감지하면 음성 사이클이 시작됩니다.
            단축키
            <kbd className="mx-1 rounded bg-bg/60 px-1 text-[10px]">Ctrl+Shift+Space</kbd>
            는 이 설정과 무관하게 항상 동작합니다.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onToggle}
          aria-pressed={enabled}
          className={`no-drag relative h-6 w-11 shrink-0 rounded-full ring-1 ring-inset ring-white/10 transition-colors disabled:opacity-50 ${enabled ? "bg-accent/80" : "bg-bg/60"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-fg shadow-sm transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </div>
    </section>
  );
}

// wake 측정 모드 — NDJSON 텔레메트리 dump on/off. eval 코드베이스에서 분석.
// 스키마는 docs/DECISIONS.md D-012.
function WakeMeasurementToggle() {
  const enabled = useUserSettingsStore((s) => s.wakeMeasurementMode);
  const setEnabled = useUserSettingsStore((s) => s.setWakeMeasurementMode);
  const voiceEnabled = useUserSettingsStore((s) => s.voiceEnabled);
  const [busy, setBusy] = useState(false);

  const onToggle = async () => {
    setBusy(true);
    try {
      await setEnabled(!enabled);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">Wake 측정 모드 (개발자)</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            wake 검출기 score를 NDJSON으로 기록합니다. 항시 청취가 켜진 동안만 데이터가 쌓입니다.
            파일은 <code className="text-fg-muted">userData/debug/wake-scores-&lt;sessionId&gt;.ndjson</code>.
          </p>
          {enabled && !voiceEnabled && (
            <p className="mt-1 text-[11px] text-amber-300">
              항시 마이크 청취가 꺼져 있어 데이터가 기록되지 않습니다.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onToggle}
          aria-pressed={enabled}
          className={`no-drag relative h-6 w-11 shrink-0 rounded-full ring-1 ring-inset ring-white/10 transition-colors disabled:opacity-50 ${enabled ? "bg-amber-400/80" : "bg-bg/60"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-fg shadow-sm transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </div>
    </section>
  );
}

function NotificationsSection() {
  const enabled = useUserSettingsStore((s) => s.notificationsEnabled);
  const ttsEnabled = useUserSettingsStore((s) => s.notificationsTtsEnabled);
  const before1h = useUserSettingsStore((s) => s.notificationsBefore1h);
  const before15m = useUserSettingsStore((s) => s.notificationsBefore15m);
  const dndEnabled = useUserSettingsStore((s) => s.notificationsDndEnabled);
  const dndStart = useUserSettingsStore((s) => s.notificationsDndStart);
  const dndEnd = useUserSettingsStore((s) => s.notificationsDndEnd);
  const setEnabled = useUserSettingsStore((s) => s.setNotificationsEnabled);
  const setTts = useUserSettingsStore((s) => s.setNotificationsTtsEnabled);
  const setBefore1h = useUserSettingsStore((s) => s.setNotificationsBefore1h);
  const setBefore15m = useUserSettingsStore((s) => s.setNotificationsBefore15m);
  const setDndEnabled = useUserSettingsStore((s) => s.setNotificationsDndEnabled);
  const setDndStart = useUserSettingsStore((s) => s.setNotificationsDndStart);
  const setDndEnd = useUserSettingsStore((s) => s.setNotificationsDndEnd);

  return (
    <section className="rounded-md border border-white/5 bg-bg-elevated/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">일정 임박 알림</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            일정 시작 전에 OS 알림을 띄웁니다. 종일 일정은 제외.
          </p>
        </div>
        <ToggleSwitch checked={enabled} onChange={(v) => void setEnabled(v)} />
      </div>

      {enabled && (
        <div className="mt-3 space-y-2.5 border-t border-white/5 pt-3">
          <ToggleRow
            label="음성으로도 알려주기 (TTS)"
            description="OS 알림과 함께 음성 발화."
            checked={ttsEnabled}
            onChange={(v) => void setTts(v)}
          />
          <ToggleRow
            label="1시간 전 알림"
            checked={before1h}
            onChange={(v) => void setBefore1h(v)}
          />
          <ToggleRow
            label="15분 전 알림"
            checked={before15m}
            onChange={(v) => void setBefore15m(v)}
          />
          <ToggleRow
            label="방해금지 시간대"
            description="이 시간대에 발생한 알림은 보내지 않습니다 (지연 발송 X)."
            checked={dndEnabled}
            onChange={(v) => void setDndEnabled(v)}
          />
          {dndEnabled && (
            <div className="flex items-center gap-2 pl-1 text-[11px] text-fg-muted">
              <input
                type="time"
                value={dndStart}
                onChange={(e) => void setDndStart(e.target.value)}
                className="no-drag rounded-md border border-white/10 bg-bg/60 px-1.5 py-0.5 text-xs outline-none focus:border-accent/60"
              />
              <span>부터</span>
              <input
                type="time"
                value={dndEnd}
                onChange={(e) => void setDndEnd(e.target.value)}
                className="no-drag rounded-md border border-white/10 bg-bg/60 px-1.5 py-0.5 text-xs outline-none focus:border-accent/60"
              />
              <span>까지</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-[11px] font-medium">{label}</p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            {description}
          </p>
        )}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`no-drag relative h-6 w-11 shrink-0 rounded-full ring-1 ring-inset ring-white/10 transition-colors disabled:opacity-50 ${checked ? "bg-accent/80" : "bg-bg/60"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-fg shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

function AutoLaunchToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.autoLaunchGet().then(setEnabled).catch(() => {});
  }, []);

  const onToggle = async () => {
    const next = !enabled;
    setBusy(true);
    try {
      await api.autoLaunchSet(next);
      setEnabled(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-white/5 bg-bg-elevated/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">시스템 시작 시 자동 실행</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            로그인 시 위젯을 자동으로 띄웁니다.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onToggle}
          aria-pressed={enabled}
          className={`no-drag relative h-6 w-11 shrink-0 rounded-full ring-1 ring-inset ring-white/10 transition-colors disabled:opacity-50 ${enabled ? "bg-accent/80" : "bg-bg/60"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-fg shadow-sm transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </div>
    </section>
  );
}

function GoogleConnectControls({ ready }: { ready: boolean }) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const s = await api.oauthGoogleStatus();
      setConnected(s.connected);
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onConnect = async () => {
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

  const onDisconnect = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.oauthGoogleDisconnect();
      setSyncMsg(null);
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSyncNow = async () => {
    setBusy(true);
    setErr(null);
    setSyncMsg(null);
    try {
      const r = await api.calendarSyncNow();
      setSyncMsg(
        `동기화: ${r.full_sync ? "전체" : "증분"} · 받음 ${r.fetched} · upsert ${r.upserts} · 삭제 ${r.deletions}`,
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-fg-subtle"}`}
        />
        <span className="text-[11px] text-fg-muted">
          {connected ? "연결됨" : "연결 안 됨"}
        </span>
      </div>
      <div className="flex gap-2">
        {!connected && (
          <button
            type="button"
            disabled={!ready || busy}
            onClick={onConnect}
            title={ready ? "" : "client_id와 client_secret을 먼저 저장하세요"}
            className="no-drag flex-1 rounded-md bg-accent/80 px-2 py-1 text-[11px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "브라우저에서 인증 중..." : "연결"}
          </button>
        )}
        {connected && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onSyncNow}
              className="no-drag rounded-md bg-accent/80 px-2 py-1 text-[11px] font-medium text-bg disabled:opacity-50"
            >
              {busy ? "..." : "지금 동기화"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDisconnect}
              className="no-drag rounded-md border border-white/10 px-2 py-1 text-[11px] text-fg-muted hover:bg-bg-elevated"
            >
              연결 끊기
            </button>
          </>
        )}
      </div>
      {syncMsg && (
        <p className="text-[11px] text-fg-muted">{syncMsg}</p>
      )}
      {err && (
        <p className="text-[11px] text-red-300">{err}</p>
      )}
    </div>
  );
}
