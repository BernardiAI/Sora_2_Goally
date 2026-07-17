import { NextResponse } from "next/server";
import { jobById, serializeJob } from "../../../../../lib/generation-store";
import { archiveJob } from "../../../../../lib/generation-service";
export const runtime="nodejs";
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}) { const {id}=await params; if(!jobById(id))return NextResponse.json({error:{code:"job_not_found",message:"Generation job not found.",retryable:false,jobId:id}},{status:404}); await archiveJob(id); return NextResponse.json({job:serializeJob(jobById(id))}); }

