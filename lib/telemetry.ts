import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { assetDir } from "./generation-store";

const logPath = path.join(path.dirname(assetDir), "operations.ndjson");
export function logEvent(level: "info" | "warn" | "error", event: string, detail: Record<string, unknown> = {}) {
  try {
    if (existsSync(logPath) && statSync(logPath).size > 5_000_000) renameSync(logPath, `${logPath}.1`);
    const safe = JSON.parse(JSON.stringify(detail, (key, value) => /authorization|api.?key/i.test(key) ? "[REDACTED]" : value));
    appendFileSync(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safe })}\n`, { mode: 0o600 });
  } catch { /* telemetry must never break generation */ }
}

