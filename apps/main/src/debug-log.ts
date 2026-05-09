import { app } from "electron";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

// wake 측정 모드용 NDJSON writer.
// 한 측정 세션 = 한 파일. 스키마는 docs/DECISIONS.md D-012.
//
// Renderer는 토글 ON 시 type:"open"으로 session record를 보내고,
// 매 inference frame에 type:"append"로 score record를 보낸다.
// 토글 OFF 시 type:"close"로 stream flush.

interface OpenPayload {
  type: "open";
  sessionId: string;
  record: unknown; // session record JSON. main은 그대로 직렬화만.
}

interface AppendPayload {
  type: "append";
  sessionId: string;
  record: unknown;
}

interface ClosePayload {
  type: "close";
  sessionId: string;
}

export type DebugWakeLogPayload = OpenPayload | AppendPayload | ClosePayload;

const streams = new Map<string, WriteStream>();

function debugDir(): string {
  const dir = join(app.getPath("userData"), "debug");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function handleDebugWakeLog(
  payload: DebugWakeLogPayload,
): { path?: string } {
  if (payload.type === "open") {
    // 같은 sessionId 중복 open은 기존 stream 재사용 — 토글 ON/OFF가 빠르게 반복돼도 안전.
    const existing = streams.get(payload.sessionId);
    if (existing) return { path: existing.path as string };

    const path = join(debugDir(), `wake-scores-${payload.sessionId}.ndjson`);
    const stream = createWriteStream(path, { flags: "a" });
    stream.write(JSON.stringify(payload.record) + "\n");
    streams.set(payload.sessionId, stream);
    return { path };
  }

  if (payload.type === "append") {
    const stream = streams.get(payload.sessionId);
    if (!stream) {
      // open 못 받은 채로 append만 들어온 경우 — drop. 호출자 버그.
      console.warn(
        `[debug-log] append for unknown session ${payload.sessionId}`,
      );
      return {};
    }
    stream.write(JSON.stringify(payload.record) + "\n");
    return {};
  }

  // close
  const stream = streams.get(payload.sessionId);
  if (stream) {
    stream.end();
    streams.delete(payload.sessionId);
  }
  return {};
}

// 앱 종료 시 열린 stream 모두 flush.
export function closeAllDebugStreams(): void {
  for (const [, stream] of streams) {
    stream.end();
  }
  streams.clear();
}
