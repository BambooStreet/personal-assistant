// 메인 프로세스 파일 로그. `userData/logs/main.log.YYYY-MM-DD`.
//
// 왜 필요한가: 패키징 앱은 **원격(클라우드) 모드**라 로컬 pa-core가 안 뜨고, 따라서
// `core.log`도 안 생긴다. console.info는 파일로 남지 않으므로 사용자 PC에서 무슨 일이
// 있었는지 사후에 알 방법이 0이었다 — "할 일 목록"이 안 뜬 사건에서 클라이언트 구간을
// 끝내 복원하지 못한 이유가 이것이다(D-023).
//
// ⚠️ 세션 토큰·시크릿은 절대 넣지 않는다. 이 파일은 사용자 디스크에 평문으로 남는다.

import { app } from "electron";
import {
  createWriteStream,
  mkdirSync,
  readdirSync,
  unlinkSync,
  type WriteStream,
} from "node:fs";
import { join } from "node:path";

// 사용자 디스크라 무한히 쌓으면 안 된다(Fly 볼륨의 core.log와 다른 점).
const RETENTION_DAYS = 14;
const PREFIX = "main.log.";

let stream: WriteStream | null = null;
let streamDate = "";

function logsDir(): string {
  const dir = join(app.getPath("userData"), "logs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 로컬 날짜 YYYY-MM-DD. 파일 경계를 사용자가 체감하는 하루에 맞춘다. */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function prune(dir: string): void {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(PREFIX)) continue;
      const date = Date.parse(name.slice(PREFIX.length));
      if (Number.isFinite(date) && date < cutoff) {
        try {
          unlinkSync(join(dir, name));
        } catch {
          /* 지우기 실패는 무시 — 로깅이 앱을 막으면 안 된다 */
        }
      }
    }
  } catch {
    /* 디렉터리 조회 실패도 무시 */
  }
}

function writer(): WriteStream | null {
  const date = localDate(new Date());
  if (stream && streamDate === date) return stream;
  try {
    stream?.end();
    const dir = logsDir();
    prune(dir);
    stream = createWriteStream(join(dir, `${PREFIX}${date}`), { flags: "a" });
    streamDate = date;
    return stream;
  } catch {
    // 로그를 못 쓰는 상황(권한 등)에서 앱이 죽으면 안 된다. 콘솔만 남기고 계속.
    stream = null;
    return null;
  }
}

/** `k=v` 목록. 공백이 든 값만 따옴표로 감싼다(grep 편의). */
function fields(data?: Record<string, unknown>): string {
  if (!data) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${s !== undefined && /\s/.test(s) ? JSON.stringify(s) : s}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function write(level: "INFO" | "WARN" | "ERROR", event: string, data?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${event}${fields(data)}`;
  // 콘솔은 dev에서 보라고 유지. 파일이 진짜 목적.
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.info(line);
  writer()?.write(`${line}\n`);
}

export function logInfo(event: string, data?: Record<string, unknown>): void {
  write("INFO", event, data);
}

export function logWarn(event: string, data?: Record<string, unknown>): void {
  write("WARN", event, data);
}

export function logError(event: string, data?: Record<string, unknown>): void {
  write("ERROR", event, data);
}

/** 앱 종료 시 flush. */
export function closeLog(): void {
  stream?.end();
  stream = null;
  streamDate = "";
}

/** 사용자에게 "로그 어디 있냐" 안내할 때 쓸 경로. */
export function logDirPath(): string {
  return join(app.getPath("userData"), "logs");
}
