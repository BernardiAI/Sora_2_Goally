import { NextResponse } from "next/server";
import { db, getState, listJobs, serializeJob } from "../../../../lib/generation-store";
import { ensureWorker } from "../../../../lib/worker";
export const runtime="nodejs";
export async function GET(){ensureWorker();const jobs=listJobs();const spend=db.prepare("SELECT COALESCE(SUM(estimated_cents),0) committed FROM spend_events WHERE kind='committed_estimate'").get() as any;return NextResponse.json({jobs:jobs.map(serializeJob),counts:Object.fromEntries([...new Set(jobs.map(j=>j.status))].map(s=>[s,jobs.filter(j=>j.status===s).length])),committedEstimateCents:spend.committed,lastReconciliation:getState("last_reconciliation"),workerHeartbeat:getState("worker_heartbeat")});}

