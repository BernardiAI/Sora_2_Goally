import { DatabaseSync } from "node:sqlite";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GenerationRequest, JobStatus } from "./generation-types";

const dataDir = process.env.SORA_DATA_DIR || path.join(process.cwd(), ".data");
export const generationsDir = process.env.SORA_GENERATIONS_DIR || path.join(process.cwd(), "generated-videos");
export const assetDir = generationsDir;
mkdirSync(dataDir, { recursive: true });
mkdirSync(generationsDir, { recursive: true });

const globalDb = globalThis as typeof globalThis & { __soraDb?: DatabaseSync };
export const db = globalDb.__soraDb ?? new DatabaseSync(path.join(dataDir, "generations.sqlite"));
globalDb.__soraDb = db;
db.exec("PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;");
try { db.exec("PRAGMA journal_mode=WAL;"); } catch { /* another build/runtime worker may be initializing it */ }
db.exec(`
  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL, request_json TEXT NOT NULL,
    estimated_cents INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, batch_id TEXT, variation_index INTEGER NOT NULL DEFAULT 0,
    request_json TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
    estimated_cents INTEGER NOT NULL, provider_video_id TEXT UNIQUE, client_request_id TEXT UNIQUE,
    provider_request_id TEXT, provider_http_status INTEGER, provider_created_at INTEGER,
    provider_completed_at INTEGER, provider_expires_at INTEGER, error_code TEXT, error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0, recovered INTEGER NOT NULL DEFAULT 0,
    last_reconciled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(batch_id) REFERENCES batches(id)
  );
  CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
  CREATE TABLE IF NOT EXISTS provider_attempts (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, operation TEXT NOT NULL, started_at TEXT NOT NULL,
    finished_at TEXT, http_status INTEGER, provider_request_id TEXT, client_request_id TEXT,
    outcome TEXT, error_code TEXT, error_message TEXT, FOREIGN KEY(job_id) REFERENCES jobs(id)
  );
  CREATE TABLE IF NOT EXISTS status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
    source TEXT NOT NULL, detail_json TEXT, created_at TEXT NOT NULL, FOREIGN KEY(job_id) REFERENCES jobs(id)
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, job_id TEXT UNIQUE NOT NULL, path TEXT, temp_path TEXT, mime_type TEXT,
    byte_count INTEGER, sha256 TEXT, verified INTEGER NOT NULL DEFAULT 0, attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(job_id) REFERENCES jobs(id)
  );
  CREATE TABLE IF NOT EXISTS spend_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, kind TEXT NOT NULL, estimated_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL, FOREIGN KEY(job_id) REFERENCES jobs(id)
  );
  CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
`);

const now = () => new Date().toISOString();
export const json = (value: unknown) => JSON.stringify(value);

export function generationDir(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid generation id.");
  return path.join(generationsDir, id);
}

export function writeManifest(id: string) {
  const row = jobById(id);
  if (!row) return;
  const dir = generationDir(id);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "request.json");
  const temp = `${target}.tmp`;
  writeFileSync(temp, JSON.stringify(serializeJob(row), null, 2), { mode: 0o600 });
  renameSync(temp, target);
}

export function createJob(request: GenerationRequest, estimatedCents: number) {
  const id = crypto.randomUUID();
  const timestamp = now();
  mkdirSync(generationDir(id), { recursive: true });
  db.prepare(`INSERT INTO jobs
    (id,variation_index,request_json,status,estimated_cents,client_request_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, 0, json(request), "draft", estimatedCents, crypto.randomUUID(), timestamp, timestamp);
  db.prepare("INSERT INTO status_events(job_id,to_status,source,created_at) VALUES (?,?,?,?)").run(id, "draft", "app", timestamp);
  db.prepare("INSERT INTO spend_events(job_id,kind,estimated_cents,created_at) VALUES (?,?,?,?)").run(id, "committed_estimate", estimatedCents, timestamp);
  writeManifest(id);
  return id;
}

export function createBatch(request: GenerationRequest, idempotencyKey: string, batchId: string, jobIds: string[], cents: number) {
  const existing = db.prepare("SELECT id FROM batches WHERE idempotency_key=?").get(idempotencyKey) as { id: string } | undefined;
  if (existing) return { batchId: existing.id, created: false };
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO batches VALUES (?, ?, ?, ?, ?, ?)").run(batchId, idempotencyKey, json(request), cents * (request.variations ?? 1), timestamp, timestamp);
    const insertJob = db.prepare(`INSERT INTO jobs
      (id,batch_id,variation_index,request_json,status,estimated_cents,client_request_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    jobIds.forEach((id, index) => {
      const clientId = crypto.randomUUID();
      insertJob.run(id, batchId, index, json({ ...request, variations: 1 }), "draft", cents, clientId, timestamp, timestamp);
      db.prepare("INSERT INTO status_events(job_id,to_status,source,created_at) VALUES (?,?,?,?)").run(id, "draft", "app", timestamp);
      db.prepare("INSERT INTO spend_events(job_id,kind,estimated_cents,created_at) VALUES (?,?,?,?)").run(id, "committed_estimate", cents, timestamp);
    });
    db.exec("COMMIT");
    return { batchId, created: true };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function transition(jobId: string, status: JobStatus, source: string, fields: Record<string, string | number | null> = {}) {
  const current = db.prepare("SELECT status FROM jobs WHERE id=?").get(jobId) as { status: string } | undefined;
  if (!current) return;
  const allowed = new Set(["progress","provider_video_id","provider_request_id","provider_http_status","provider_created_at","provider_completed_at","provider_expires_at","error_code","error_message","last_reconciled_at","retry_count"]);
  const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
  const sets = ["status=?", "updated_at=?", ...entries.map(([key]) => `${key}=?`)];
  db.prepare(`UPDATE jobs SET ${sets.join(",")} WHERE id=?`).run(status, now(), ...entries.map(([, value]) => value ?? null), jobId);
  if (current.status !== status) db.prepare("INSERT INTO status_events(job_id,from_status,to_status,source,detail_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(jobId, current.status, status, source, json(fields), now());
  writeManifest(jobId);
}

export function jobById(id: string) { return db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as any; }
export function jobByProviderId(id: string) { return db.prepare("SELECT * FROM jobs WHERE provider_video_id=?").get(id) as any; }
export function listJobs() { return db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as any[]; }
export function activeJobs() { return db.prepare("SELECT * FROM jobs WHERE status IN ('queued','in_progress','completed','archiving','archive_failed','stalled') ORDER BY updated_at").all() as any[]; }
export function eventsForJob(id: string) { return db.prepare("SELECT * FROM status_events WHERE job_id=? ORDER BY id DESC").all(id); }
export function assetForJob(id: string) { return db.prepare("SELECT * FROM assets WHERE job_id=?").get(id) as any; }
export function setState(key: string, value: string) { db.prepare("INSERT INTO app_state VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key,value,now()); }
export function getState(key: string) { return (db.prepare("SELECT value FROM app_state WHERE key=?").get(key) as any)?.value as string | undefined; }

export function serializeJob(row: any) {
  const request = JSON.parse(row.request_json);
  const asset = assetForJob(row.id);
  if (request.reference) request.reference = { name: request.reference.name, type: request.reference.type, storedFile: path.basename(request.reference.path) };
  return { ...row, request, request_json: undefined, client_request_id: undefined, asset: asset ? { verified: asset.verified, mime_type: asset.mime_type, byte_count: asset.byte_count, sha256: asset.sha256 } : null };
}

export function importProviderJob(video: any) {
  const existing = jobByProviderId(video.id);
  if (existing) return existing.id as string;
  const id = crypto.randomUUID();
  const timestamp = now();
  const request = { prompt: video.prompt || "Recovered OpenAI generation", model: video.model || "sora-2", seconds: String(video.seconds || "4"), size: video.size || "1280x720" };
  const providerStatus = video.status === "completed" ? "completed" : video.status === "failed" ? (video.error?.code === "moderation_blocked" ? "moderation_blocked" : "failed") : video.status === "cancelled" ? "cancelled" : video.status === "in_progress" ? "in_progress" : "queued";
  db.prepare(`INSERT INTO jobs
    (id,variation_index,request_json,status,progress,estimated_cents,provider_video_id,provider_created_at,provider_completed_at,provider_expires_at,error_code,error_message,recovered,last_reconciled_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,0,json(request),providerStatus,video.progress || 0,0,video.id,video.created_at || null,video.completed_at || null,video.expires_at || null,video.error?.code || null,video.error?.message || null,1,timestamp,timestamp,timestamp);
  db.prepare("INSERT INTO status_events(job_id,to_status,source,detail_json,created_at) VALUES (?,?,?,?,?)").run(id,providerStatus,"provider_recovery",json({providerVideoId:video.id}),timestamp);
  writeManifest(id);
  return id;
}
