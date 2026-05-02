import { useEffect, useState } from "react";

import paApi from "../../lib/api";
import { api, type SecretSlot, type SecretStatus } from "../../lib/runtime";
import { useUserSettingsStore } from "../../stores/useUserSettingsStore";

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

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <h3 className="text-sm font-semibold">설정</h3>

      <UserNameField />
      <VoiceModeToggle />
      <AutoLaunchToggle />

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

      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
          {err}
        </div>
      )}
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
          <p className="text-xs font-medium">항시 마이크 청취 (예정)</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            wake word 모델이 켜져 호출 단어를 감지합니다. 현재는 미구현 — 단축키
            <kbd className="mx-1 rounded bg-bg/60 px-1 text-[10px]">Ctrl+Shift+Space</kbd>
            로 사이클 트리거.
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

function AutoLaunchToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    paApi.autoLaunchGet().then(setEnabled).catch(() => {});
  }, []);

  const onToggle = async () => {
    const next = !enabled;
    setBusy(true);
    try {
      await paApi.autoLaunchSet(next);
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
