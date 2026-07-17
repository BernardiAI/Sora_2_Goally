import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createJob, generationDir, listJobs, serializeJob, writeManifest } from "../../../lib/generation-store";
import { submitJob } from "../../../lib/generation-service";
import { ensureWorker } from "../../../lib/worker";
import { estimateVideoCents, isValidVideoRequest, type VideoModel, type VideoSeconds } from "../../../lib/video-config";

export const runtime = "nodejs";
const imageTypes = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export async function GET() {
  ensureWorker();
  return NextResponse.json({ jobs: listJobs().map(serializeJob) });
}

export async function POST(request: NextRequest) {
  ensureWorker();
  const contentType = request.headers.get("content-type") || "";
  let value: any;
  let reference: File | null = null;
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    value = Object.fromEntries(["prompt", "model", "seconds", "size"].map((key) => [key, form.get(key)]));
    const candidate = form.get("input_reference");
    reference = candidate instanceof File && candidate.size ? candidate : null;
  } else value = await request.json().catch(() => null);

  if (!isValidVideoRequest(value)) return NextResponse.json({ error: "Prompt, model, duration, and a valid model resolution are required." }, { status: 400 });
  if (reference && (!imageTypes.has(reference.type) || reference.size > MAX_REFERENCE_BYTES))
    return NextResponse.json({ error: "Reference images must be JPEG, PNG, or WebP and no larger than 20 MB." }, { status: 400 });

  const model = value.model as VideoModel; const seconds = String(value.seconds) as VideoSeconds;
  const requestValue: any = { prompt: value.prompt.trim(), model, seconds, size: value.size };
  const id = createJob(requestValue, estimateVideoCents(model, value.size, seconds));
  if (reference) {
    const target = path.join(generationDir(id), `reference${imageTypes.get(reference.type)}`);
    await BunlessWrite(target, reference);
    requestValue.reference = { name: reference.name, type: reference.type, path: target };
    const { db } = await import("../../../lib/generation-store");
    db.prepare("UPDATE jobs SET request_json=? WHERE id=?").run(JSON.stringify(requestValue), id);
    writeManifest(id);
  }
  await submitJob(id);
  const { jobById } = await import("../../../lib/generation-store");
  return NextResponse.json({ job: serializeJob(jobById(id)) }, { status: 201 });
}

async function BunlessWrite(target: string, file: File) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(target, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
}
