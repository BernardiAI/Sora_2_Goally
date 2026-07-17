import { NextResponse } from "next/server";
import { jobById, serializeJob } from "../../../../lib/generation-store";
import { reconcileJob } from "../../../../lib/generation-service";
export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let job = jobById(id);
  if (!job) return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  if (["queued", "in_progress", "completed", "archiving", "archive_failed"].includes(job.status)) await reconcileJob(id);
  job = jobById(id);
  return NextResponse.json({ job: serializeJob(job) });
}
