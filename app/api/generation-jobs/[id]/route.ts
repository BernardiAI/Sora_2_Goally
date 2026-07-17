import { NextResponse } from "next/server";
import { eventsForJob, jobById, serializeJob } from "../../../../lib/generation-store";
import { ensureWorker } from "../../../../lib/worker";
export const runtime = "nodejs";
export async function GET(_: Request,{params}:{params:Promise<{id:string}>}) {
  ensureWorker(); const {id}=await params; const job=jobById(id);
  if(!job) return NextResponse.json({error:{code:"job_not_found",message:"Generation job not found.",retryable:false,jobId:id}},{status:404});
  return NextResponse.json({job:serializeJob(job),events:eventsForJob(id)});
}

