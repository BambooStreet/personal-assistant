import WebSocket from "ws";
import type { CoreClient } from "@pa/core-rpc";

import { logError, logInfo, logWarn } from "../log";

// Phase 8: 데스크톱이 로컬 Core 대신 클라우드 Core(게이트웨이)에 WS로 접속.
// CoreSupervisor와 동일한 표면(start/request/shutdown + onEvent/onCrash)을 구현해
// Main의 코드 경로를 그대로 둔 채 coreMode 플래그로만 교체한다.

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RemoteCoreOptions {
  /** wss://<app>.fly.dev */
  url: string;
  /** PA_GATEWAY_TOKEN */
  token: string;
  onEvent?: (name: string, data: unknown) => void;
  onCrash?: (reason: string, willRestart: boolean, attempt: number) => void;
}

export class RemoteCore implements CoreClient {
  private ws: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private reconnectAttempts = 0;
  private intentionalShutdown = false;
  private opts: RemoteCoreOptions;
  // 연결 준비 게이트 — 연결되면 resolve. 부팅 직후 요청이 핸드셰이크를 기다리게 한다.
  private ready!: Promise<void>;
  private resolveReady: () => void = () => {};

  constructor(opts: RemoteCoreOptions) {
    this.opts = opts;
    this.armReady();
  }

  private armReady(): void {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  start(): void {
    this.connect();
  }

  private connect(): void {
    // ⚠️ 토큰은 절대 로깅하지 않는다 — 이 로그는 사용자 디스크에 평문으로 남는다.
    logInfo("remote-core connecting", { url: this.opts.url, attempt: this.reconnectAttempts });
    const ws = new WebSocket(this.opts.url, {
      headers: { Authorization: `Bearer ${this.opts.token}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      logInfo("remote-core connected", { url: this.opts.url });
      this.reconnectAttempts = 0;
      this.resolveReady();
    });
    ws.on("message", (raw) => this.handleMessage(raw.toString()));
    ws.on("error", (err) => logError("remote-core ws error", { message: err.message }));
    ws.on("close", (code) => {
      // 진행 중이던 요청이 여기서 전부 reject된다 — 사용자에겐 "응답이 안 옴"으로 보인다.
      logWarn("remote-core disconnected", { code, pending: this.pending.size });
      this.rejectAllPending(new Error(`gateway 연결 종료 (code=${code})`));
      this.ws = null;
      if (this.intentionalShutdown) return;

      // 1008 = 인증 실패(세션 만료/무효). 재연결하지 말고 상위에 알려 로그인 재요구.
      if (code === 1008) {
        this.intentionalShutdown = true;
        this.opts.onCrash?.("unauthorized", false, this.reconnectAttempts);
        return;
      }

      this.reconnectAttempts += 1;
      this.armReady(); // 다음 연결을 기다릴 새 게이트
      const delayMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 30_000);
      logInfo("remote-core reconnect scheduled", {
        attempt: this.reconnectAttempts,
        delay_ms: delayMs,
      });
      // 클라우드 의존이므로 무한 재연결(백오프 상한 30s). UI엔 크래시로 알림.
      this.opts.onCrash?.(`gateway disconnected (code=${code})`, true, this.reconnectAttempts);
      setTimeout(() => {
        if (!this.intentionalShutdown) this.connect();
      }, delayMs);
    });
  }

  async request<T = unknown>(
    method: string,
    params: unknown = null,
    timeoutMs = 60_000,
  ): Promise<T> {
    // 아직 연결 전이면 핸드셰이크 완료까지 잠깐 대기(부팅 직후 요청 race 방지).
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const waitMs = Math.min(timeoutMs, 20_000);
      let t: NodeJS.Timeout;
      const timeout = new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(new Error("core not connected")), waitMs);
      });
      try {
        await Promise.race([this.ready, timeout]);
      } finally {
        clearTimeout(t!);
      }
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("core not connected");
    }
    const id = this.nextId++;
    // params는 로깅하지 않는다 — 채팅 본문·일정 제목이 그대로 들어온다.
    const started = Date.now();
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        logWarn("rpc timeout", { id, method, elapsed_ms: Date.now() - started });
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
    });
    ws.send(JSON.stringify({ id, method, params }));
    // 요청과 응답을 같은 id로 짝지어 남긴다 — 이게 있어야 "느린 건지 안 온 건지"가 갈린다.
    logInfo("rpc →", { id, method });
    return promise
      .then((v) => {
        logInfo("rpc ←", { id, method, elapsed_ms: Date.now() - started, ok: true });
        return v;
      })
      .catch((e: unknown) => {
        logWarn("rpc ←", {
          id,
          method,
          elapsed_ms: Date.now() - started,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      });
  }

  async shutdown(): Promise<void> {
    this.intentionalShutdown = true;
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(line: string): void {
    let msg: {
      id?: number | string;
      result?: unknown;
      error?: { message: string };
      type?: string;
      name?: string;
      data?: unknown;
    };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.type === "event" && typeof msg.name === "string") {
      this.opts.onEvent?.(msg.name, msg.data);
      return;
    }

    if (typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
