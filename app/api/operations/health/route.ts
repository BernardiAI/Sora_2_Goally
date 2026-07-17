import { accessSync, constants, statfsSync } from "node:fs";
import { NextResponse } from "next/server";
import { assetDir, db, getState } from "../../../../lib/generation-store";
import { ensureWorker } from "../../../../lib/worker";
export const runtime="nodejs";
export async function GET(){ensureWorker();let storageWritable=true,freeBytes=0,database=true;try{accessSync(assetDir,constants.W_OK);const s=statfsSync(assetDir);freeBytes=Number(s.bavail)*Number(s.bsize);}catch{storageWritable=false}try{db.prepare("SELECT 1").get()}catch{database=false}const unresolved=(db.prepare("SELECT COUNT(*) count FROM jobs WHERE status IN ('submission_unknown','stalled','archive_failed')").get() as any).count;return NextResponse.json({ok:database&&storageWritable,database,storageWritable,freeBytes,providerConfigured:Boolean(process.env.OPENAI_API_KEY),workerHeartbeat:getState("worker_heartbeat"),lastReconciliation:getState("last_reconciliation"),unresolved});}

