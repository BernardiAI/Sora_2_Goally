import { NextResponse } from "next/server";
import { reconcileAll } from "../../../../lib/generation-service";
export const runtime="nodejs";
export async function POST(){try{await reconcileAll();return NextResponse.json({ok:true,completedAt:new Date().toISOString()});}catch(error){return NextResponse.json({error:{code:"reconciliation_failed",message:error instanceof Error?error.message:"Reconciliation failed.",retryable:true}},{status:502});}}

