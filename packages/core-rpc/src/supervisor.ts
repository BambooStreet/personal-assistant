import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CoreOptions {
  /** pa-core 실행 파일 절대 경로. (Electron 결합 제거 — 호출 측이 결정) */
  corePath: string;
  /** SQLite 등 데이터 디렉터리. 기본 args(`--data-dir <dataDir>`)에 사용. */
  dataDir: string;
  /** spawn 인자 오버라이드. 미지정 시 `["--data-dir", dataDir]`. */
  args?: string[];
  onEvent?: (name: string, data: unknown) => void;
  onCrash?: (reason: string, willRestart: boolean, attempt: number) => void;
}

/**
 * pa-core(stdio JSON-RPC 사이드카) supervisor.
 * Electron Main·클라우드 게이트웨이·봇이 공유하는 전송 계층.
 * 줄바꿈 구분 JSON, id 매칭 응답, `method:"event"` 비동기 이벤트, 크래시 재시작(backoff).
 */
export class CoreSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private restartAttempts = 0;
  private intentionalShutdown = false;
  private opts: CoreOptions;

  constructor(opts: CoreOptions) {
    this.opts = opts;
  }

  start(): void {
    const corePath = this.opts.corePath;
    const args = this.opts.args ?? ["--data-dir", this.opts.dataDir];
    console.info("[supervisor] spawning core:", corePath);

    const child = spawn(corePath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    const stdoutLines = readline.createInterface({ input: child.stdout });
    stdoutLines.on("line", (line) => this.handleStdoutLine(line));

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trimEnd();
      if (text) console.error("[core stderr]", text);
    });

    child.on("error", (err) => {
      console.error("[supervisor] spawn error:", err);
    });

    child.on("exit", (code, signal) => {
      console.warn(
        `[supervisor] core exited code=${code} signal=${signal} intentional=${this.intentionalShutdown}`,
      );
      this.rejectAllPending(
        new Error(`core process exited (code=${code} signal=${signal})`),
      );
      this.child = null;
      if (this.intentionalShutdown) return;

      this.restartAttempts += 1;
      const willRestart = this.restartAttempts <= 3;
      this.opts.onCrash?.(
        `code=${code} signal=${signal}`,
        willRestart,
        this.restartAttempts,
      );
      if (willRestart) {
        const delayMs = Math.min(1000 * 2 ** (this.restartAttempts - 1), 5000);
        console.warn(
          `[supervisor] restarting in ${delayMs}ms (attempt ${this.restartAttempts}/3)`,
        );
        setTimeout(() => this.start(), delayMs);
      } else {
        console.error("[supervisor] giving up after 3 restart attempts");
      }
    });
  }

  async request<T = unknown>(
    method: string,
    params: unknown = null,
    timeoutMs = 60_000,
  ): Promise<T> {
    if (!this.child) {
      throw new Error("core not running");
    }
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    const line = JSON.stringify(msg) + "\n";

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
    });

    if (!this.child.stdin.writable) {
      this.pending.delete(id);
      throw new Error("core stdin not writable");
    }
    this.child.stdin.write(line);

    return promise;
  }

  async shutdown(): Promise<void> {
    this.intentionalShutdown = true;
    if (!this.child) return;
    try {
      await Promise.race([
        this.request("shutdown").catch(() => undefined),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    } finally {
      if (this.child) {
        this.child.kill();
        this.child = null;
      }
    }
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: {
      jsonrpc?: string;
      id?: number | string | null;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
      method?: string;
      params?: { name?: string; data?: unknown };
    };
    try {
      msg = JSON.parse(trimmed);
    } catch (e) {
      console.error("[supervisor] non-JSON stdout:", trimmed.slice(0, 200));
      return;
    }

    if (msg.method === "event" && msg.params?.name) {
      this.opts.onEvent?.(msg.params.name, msg.params.data);
      this.restartAttempts = 0; // 정상 통신이 들어오면 카운터 리셋
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
