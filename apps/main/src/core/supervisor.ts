import { app } from "electron";
import path from "node:path";
import { CoreSupervisor as BaseCoreSupervisor } from "@pa/core-rpc";

// 전송 로직은 @pa/core-rpc로 추출됨. Main은 Electron 결합부(바이너리 경로 해석)만 담당.
interface MainCoreOptions {
  dataDir: string;
  onEvent?: (name: string, data: unknown) => void;
  onCrash?: (reason: string, willRestart: boolean, attempt: number) => void;
}

function resolveCorePath(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", `pa-core${ext}`);
  }
  // dev: monorepo 구조에서 core/target/release/pa-core(.exe)
  return path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "core",
    "target",
    "release",
    `pa-core${ext}`,
  );
}

export class CoreSupervisor extends BaseCoreSupervisor {
  constructor(opts: MainCoreOptions) {
    super({ ...opts, corePath: resolveCorePath() });
  }
}
