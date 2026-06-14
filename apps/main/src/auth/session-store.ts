import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

// 세션 JWT를 OS 암호화(safeStorage=DPAPI/Keychain)로 userData에 저장. 평문 저장 금지.
// 데스크톱은 서명 검증은 안 하고 exp만 읽어 유효성 판단(검증 권한은 게이트웨이).

function sessionPath(): string {
  return path.join(app.getPath("userData"), "session.bin");
}

function decodeExp(jwt: string): number | null {
  const seg = jwt.split(".")[1];
  if (!seg) return null;
  try {
    const json = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export interface StoredSession {
  token: string;
  /** epoch seconds. */
  exp: number;
}

export function saveSession(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS 암호화(safeStorage)를 사용할 수 없습니다");
  }
  const enc = safeStorage.encryptString(token);
  fs.writeFileSync(sessionPath(), enc);
}

/** 저장된 세션. 없거나 손상/만료면 null. */
export function loadSession(): StoredSession | null {
  const p = sessionPath();
  if (!fs.existsSync(p)) return null;
  try {
    const token = safeStorage.decryptString(fs.readFileSync(p));
    const exp = decodeExp(token);
    if (exp == null) return null;
    // 60초 여유로 만료 판단.
    if (exp <= Math.floor(Date.now() / 1000) + 60) return null;
    return { token, exp };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    fs.rmSync(sessionPath(), { force: true });
  } catch {
    /* noop */
  }
}
