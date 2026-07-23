import { NextRequest, NextResponse } from "next/server";
import { batchEstimateCents, unitEstimateCents } from "../../../lib/pricing";
import { createBatch, db, listJobs, serializeJob } from "../../../lib/generation-store";
import { submitJob } from "../../../lib/generation-service";
import { ensureWorker } from "../../../lib/worker";
import type { ApiError, GenerationRequest } from "../../../lib/generation-types";
import { isValidVideoRequest, VIDEO_SECONDS, type VideoSeconds } from "../../../lib/video-config";

export const runtime = "nodejs";
const error = (status: number, body: ApiError) => NextResponse.json({ error: body }, { status });

function validate(value: any): GenerationRequest | null {
  const prompt = typeof value?.prompt === "string" ? value.prompt.trim() : "";
  const model: GenerationRequest["model"] | null = value?.model === "sora-2-pro" ? "sora-2-pro" : value?.model === "sora-2" ? "sora-2" : null;
  const seconds = VIDEO_SECONDS.includes(String(value?.seconds) as VideoSeconds) ? String(value.seconds) as VideoSeconds : null;
  const size = typeof value?.size === "string" ? value.size : null;
  const variations = [1,2,4].includes(Number(value?.variations)) ? Number(value.variations) as 1|2|4 : null;
  const candidate = prompt && model && seconds && size ? { prompt,model,seconds,size } : null;
  return candidate && variations && isValidVideoRequest(candidate) ? { ...candidate,variations } : null;
}

export async function GET() {
  ensureWorker();
  const batches = db.prepare("SELECT * FROM batches ORDER BY created_at DESC").all() as any[];
  return NextResponse.json({ batches: batches.map(batch => ({ ...batch, request:JSON.parse(batch.request_json), request_json:undefined, jobs:listJobs().filter(job=>job.batch_id===batch.id).map(serializeJob) })), recoveredJobs:listJobs().filter(job=>!job.batch_id).map(serializeJob) });
}

export async function POST(request: NextRequest) {
  ensureWorker();
  const body = await request.json().catch(()=>null);
  const input = validate(body);
  if (!input) return error(400,{code:"invalid_generation_request",message:"Prompt, model, duration, size, and variations are required.",retryable:false});
  const estimatedCents = batchEstimateCents(input);
  const perJobLimit = Number(process.env.SORA_MAX_JOB_CENTS || 1000);
  const batchLimit = Number(process.env.SORA_MAX_BATCH_CENTS || 2000);
  const dailyLimit = Number(process.env.SORA_MAX_DAILY_CENTS || 5000);
  const monthlyLimit = Number(process.env.SORA_MAX_MONTHLY_CENTS || 20000);
  const unit = unitEstimateCents(input);
  const today = new Date().toISOString().slice(0,10);
  const month = today.slice(0,7);
  const daily = (db.prepare("SELECT COALESCE(SUM(estimated_cents),0) total FROM spend_events WHERE kind='committed_estimate' AND created_at>=?").get(`${today}T00:00:00.000Z`) as any).total;
  const monthly = (db.prepare("SELECT COALESCE(SUM(estimated_cents),0) total FROM spend_events WHERE kind='committed_estimate' AND created_at>=?").get(`${month}-01T00:00:00.000Z`) as any).total;
  if (unit > perJobLimit || estimatedCents > batchLimit || daily + estimatedCents > dailyLimit || monthly + estimatedCents > monthlyLimit)
    return error(422,{code:"spend_limit_exceeded",message:`This $${(estimatedCents/100).toFixed(2)} estimated batch exceeds a configured spend limit.`,retryable:false});
  if (body.confirmedEstimateCents !== estimatedCents)
    return NextResponse.json({code:"estimate_confirmation_required",estimatedCents,previousEstimateCents:body.confirmedEstimateCents ?? null},{status:409});
  const idempotencyKey = request.headers.get("idempotency-key") || crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const jobIds = Array.from({length:input.variations ?? 1},()=>crypto.randomUUID());
  const created = createBatch(input,idempotencyKey,batchId,jobIds,unit);
  if (created.created) await Promise.all(jobIds.map(submitJob));
  const rows = listJobs().filter(job=>job.batch_id===created.batchId).map(serializeJob);
  return NextResponse.json({batchId:created.batchId,estimatedCents,jobs:rows,deduplicated:!created.created},{status:created.created?201:200});
}
