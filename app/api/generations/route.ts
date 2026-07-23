import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { charactersByProviderIds, createJob, generationDir, listJobs, serializeJob, writeManifest } from "../../../lib/generation-store";
import { submitJob } from "../../../lib/generation-service";
import { ensureWorker } from "../../../lib/worker";
import { estimateVideoCents, isValidVideoRequest, type VideoModel, type VideoSeconds } from "../../../lib/video-config";

export const runtime = "nodejs";
const imageTypes = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_REFERENCE_BYTES = 100 * 1024 * 1024;

export async function GET() {
  ensureWorker();
  return NextResponse.json({ jobs: listJobs().map(serializeJob) });
}

export async function POST(request: NextRequest) {
  ensureWorker();
  const contentType = request.headers.get("content-type") || "";
  let value: any;
  let reference: File | null = null;
  let referencePhotos: File[] = [];
  let videoReference: File | null = null;
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    value = Object.fromEntries(["prompt", "model", "seconds", "size"].map((key) => [key, form.get(key)]));
    value.character_ids = form.get("character_ids");
    const candidate = form.get("input_reference");
    reference = candidate instanceof File && candidate.size ? candidate : null;
    referencePhotos = form.getAll("reference_photos").filter((candidate): candidate is File => candidate instanceof File && candidate.size > 0);
    const videoCandidate = form.get("video_reference");
    videoReference = videoCandidate instanceof File && videoCandidate.size ? videoCandidate : null;
  } else value = await request.json().catch(() => null);

  if (!isValidVideoRequest(value)) return NextResponse.json({ error: "Prompt, model, duration, and a valid model resolution are required." }, { status: 400 });
  if (reference && (!imageTypes.has(reference.type) || reference.size > MAX_REFERENCE_BYTES))
    return NextResponse.json({ error: "Reference images must be JPEG, PNG, or WebP and no larger than 20 MB." }, { status: 400 });
  if (referencePhotos.length > 5) return NextResponse.json({ error: "Sora 2 Pro visual guidance accepts up to 5 reference photos." }, { status: 400 });
  if (referencePhotos.length && value.model !== "sora-2-pro") return NextResponse.json({ error: "Additional reference photos are available only with Sora 2 Pro." }, { status: 400 });
  if (referencePhotos.some((photo) => !imageTypes.has(photo.type) || photo.size > MAX_REFERENCE_BYTES))
    return NextResponse.json({ error: "Reference photos must be JPEG, PNG, or WebP and no larger than 20 MB each." }, { status: 400 });
  if (videoReference && (videoReference.type !== "video/mp4" || videoReference.size > MAX_VIDEO_REFERENCE_BYTES))
    return NextResponse.json({ error: "Reference videos must be MP4 and no larger than 100 MB." }, { status: 400 });

  let characterIds: string[] = [];
  try { characterIds = value.character_ids ? JSON.parse(String(value.character_ids)) : []; } catch { return NextResponse.json({ error: "Character IDs must be a valid list." }, { status: 400 }); }
  if (!Array.isArray(characterIds) || characterIds.some((id) => typeof id !== "string")) return NextResponse.json({ error: "Character IDs must be a valid list." }, { status: 400 });
  characterIds = [...new Set(characterIds)];
  if (characterIds.length + (videoReference ? 1 : 0) > 2) return NextResponse.json({ error: "Sora allows at most 2 characters in one generation, including the uploaded reference video." }, { status: 400 });
  const characters = charactersByProviderIds(characterIds);
  if (characters.length !== characterIds.length) return NextResponse.json({ error: "One or more selected character IDs are unavailable." }, { status: 400 });

  const model = value.model as VideoModel; const seconds = String(value.seconds) as VideoSeconds;
  const requestValue: any = { prompt: value.prompt.trim(), model, seconds, size: value.size };
  if (characters.length) requestValue.characters = characters.map((character) => ({ id: character.provider_character_id, name: character.name, description: character.description }));
  const id = createJob(requestValue, estimateVideoCents(model, value.size, seconds));
  if (reference) {
    const target = path.join(generationDir(id), `reference${imageTypes.get(reference.type)}`);
    await BunlessWrite(target, reference);
    requestValue.reference = { name: reference.name, type: reference.type, path: target };
    const { db } = await import("../../../lib/generation-store");
    db.prepare("UPDATE jobs SET request_json=? WHERE id=?").run(JSON.stringify(requestValue), id);
    writeManifest(id);
  }
  if (referencePhotos.length) {
    requestValue.referencePhotos = [];
    for (const [index, photo] of referencePhotos.entries()) {
      const target = path.join(generationDir(id), `reference-photo-${index + 1}${imageTypes.get(photo.type)}`);
      await BunlessWrite(target, photo);
      requestValue.referencePhotos.push({ name: photo.name, type: photo.type, path: target });
    }
    const { db } = await import("../../../lib/generation-store");
    db.prepare("UPDATE jobs SET request_json=? WHERE id=?").run(JSON.stringify(requestValue), id);
    writeManifest(id);
  }
  if (videoReference) {
    const target = path.join(generationDir(id), "reference-original.mp4");
    await BunlessWrite(target, videoReference);
    requestValue.videoReference = { name: videoReference.name, type: "video/mp4", path: target };
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
