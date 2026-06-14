import WebSocket from "ws";
import type { CoreClient } from "@pa/core-rpc";

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

  constructor(opts: RemoteCoreOptions) {
    this.opts = opts;
  }

  start(): void {
    this.connect();
  }

  private connect(): void {
    console.info("[remote-core] connecting:", this.opts.url);
    const ws = new WebSocket(this.opts.url, {
      headers: { Authorization: `Bearer ${this.opts.token}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      console.info("[remote-core] connected");
      this.reconnectAttempts = 0;
    });
    ws.on("message", (raw) => this.handleMessage(raw.toString()));
    ws.on("error", (err) => console.error("[remote-core] ws error:", err.message));
    ws.on("close", (code) => {
      this.rejectAllPending(new Error(`gateway 연결 종료 (code=${code})`));
      this.ws = null;
      if (this.intentionalShutdown) return;

      this.reconnectAttempts += 1;
      const delayMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 30_000);
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
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("core not connected");
    }
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
    });
    ws.send(JSON.stringify({ id, method, params }));
    return promise;
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
