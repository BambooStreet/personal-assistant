/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 시점에 주입되는 git HEAD SHA.
// wake telemetry NDJSON 헤더의 prod_commit_sha에 박는 용도.
declare const __APP_COMMIT_SHA__: string;
