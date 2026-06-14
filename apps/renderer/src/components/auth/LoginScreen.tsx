import { useAuthStore } from "../../stores/useAuthStore";

// 원격(클라우드) 모드 로그인 게이트. "Google로 로그인" → Main이 시스템 브라우저로 OAuth 수행.
export function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div>
        <p className="text-sm font-medium text-fg">개인 비서에 로그인</p>
        <p className="mt-1 text-[11px] text-fg-muted">
          Google 계정으로 로그인하면 폰·데스크톱이 같은 비서를 공유합니다.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void login()}
        disabled={loading}
        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-fg hover:bg-white/10 disabled:opacity-50"
      >
        {loading ? "브라우저에서 로그인 중…" : "Google로 로그인"}
      </button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {loading && (
        <p className="text-[10px] text-fg-subtle">
          열린 브라우저 창에서 계속 진행하세요.
        </p>
      )}
    </div>
  );
}
