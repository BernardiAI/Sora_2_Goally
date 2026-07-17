import { NextResponse } from "next/server";
import { jobById, serializeJob } from "../../../../../lib/generation-store";
import { reconcileJob } from "../../../../../lib/generation-service";
export const runtime="nodejs";
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}) { const {id}=await params; const job=jobById(id); if(!job)return NextResponse.json({error:{code:"job_not_found",message:"Generation job not found.",retryable:false,jobId:id}},{status:404}); await reconcileJob(id); return NextResponse.json({job:serializeJob(jobById(id))}); }

