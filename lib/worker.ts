import { activeJobs, db, setState } from "./generation-store";
import { archiveJob, reconcileAll, reconcileJob } from "./generation-service";
import { logEvent } from "./telemetry";

const globalWorker = globalThis as typeof globalThis & { __soraWorker?: { timer: NodeJS.Timeout; running: boolean } };

async function tick() {
  const state = globalWorker.__soraWorker;
  if (!state || state.running) return;
  state.running = true;
  setState("worker_heartbeat",new Date().toISOString());
  try {
    for (const job of activeJobs()) {
      if (job.status === "completed" || job.status === "archive_failed") await archiveJob(job.id);
      else await reconcileJob(job.id);
    }
    const last = db.prepare("SELECT value FROM app_state WHERE key='last_reconciliation'").get() as any;
    if (!last || Date.now() - Date.parse(last.value) > 5 * 60_000) await reconcileAll();
  } catch (error) { logEvent("error","worker.tick_failed",{error:error instanceof Error?error.message:String(error)}); }
  finally { state.running = false; setState("worker_heartbeat",new Date().toISOString()); }
}

export function ensureWorker() {
  if (!globalWorker.__soraWorker) {
    globalWorker.__soraWorker = { timer: setInterval(tick,15_000), running:false };
    globalWorker.__soraWorker.timer.unref();
    void tick();
  }
}

