import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { charactersByProviderIds, createJob, generationDir, listJobs, serializeJob, writeManifest } from "../../../lib/generation-store";
import { submitJob } from "../../../lib/generation-service";
import { ensureWorker } from "../../../lib/worker";
import { estimateVideoCents, isValidVideoRequest, type VideoModel, type VideoSeconds } from "../../../lib/video-config";
import { buildSoraPrompt, validateDialogue } from "../../../lib/sora-prompt";

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
  let videoReferences: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    value = Object.fromEntries(["prompt", "dialogue", "audio_direction", "consistency_guardrails", "video_reference_metadata", "video_reference_name", "model", "seconds", "size"].map((key) => [key, form.get(key)]));
    value.character_ids = form.get("character_ids");
    const candidate = form.get("input_reference");
    reference = candidate instanceof File && candidate.size ? candidate : null;
    if (form.getAll("reference_photos").some((candidate) => candidate instanceof File && candidate.size > 0))
      return NextResponse.json({ error: "Additional reference photos are not supported by the Sora API. Use one opening-frame reference image." }, { status: 400 });
    videoReferences = form.getAll("video_references").filter((candidate): candidate is File => candidate instanceof File && candidate.size > 0);
    const legacyVideoCandidate = form.get("video_reference");
    if (!videoReferences.length && legacyVideoCandidate instanceof File && legacyVideoCandidate.size) videoReferences = [legacyVideoCandidate];
  } else value = await request.json().catch(() => null);

  if (!isValidVideoRequest(value)) return NextResponse.json({ error: "Prompt, model, duration, and a valid model resolution are required." }, { status: 400 });
  const dialogueError = validateDialogue(typeof value.dialogue === "string" ? value.dialogue : "");
  if (dialogueError) return NextResponse.json({ error: dialogueError }, { status: 400 });
  if (reference && (!imageTypes.has(reference.type) || reference.size > MAX_REFERENCE_BYTES))
    return NextResponse.json({ error: "Reference images must be JPEG, PNG, or WebP and no larger than 20 MB." }, { status: 400 });
  if (videoReferences.length > 2) return NextResponse.json({ error: "Sora allows at most 2 AI-extracted character guidance clips." }, { status: 400 });
  if (videoReferences.some((item) => item.type !== "video/mp4" || item.size > MAX_VIDEO_REFERENCE_BYTES))
    return NextResponse.json({ error: "Reference videos must be MP4 and no larger than 100 MB." }, { status: 400 });

  let characterIds: string[] = [];
  try { characterIds = value.character_ids ? JSON.parse(String(value.character_ids)) : []; } catch { return NextResponse.json({ error: "Character IDs must be a valid list." }, { status: 400 }); }
  if (!Array.isArray(characterIds) || characterIds.some((id) => typeof id !== "string")) return NextResponse.json({ error: "Character IDs must be a valid list." }, { status: 400 });
  characterIds = [...new Set(characterIds)];
  if (characterIds.length + videoReferences.length > 2) return NextResponse.json({ error: "Sora allows at most 2 total characters across saved Character IDs and AI-extracted guidance clips." }, { status: 400 });
  const characters = charactersByProviderIds(characterIds);
  if (characters.length !== characterIds.length) return NextResponse.json({ error: "One or more selected character IDs are unavailable." }, { status: 400 });

  const model = value.model as VideoModel; const seconds = String(value.seconds) as VideoSeconds;
  let videoReferenceMetadata: Array<{ characterName: string; description: string }> = [];
  try {
    videoReferenceMetadata = value.video_reference_metadata
      ? JSON.parse(String(value.video_reference_metadata))
      : videoReferences.length
        ? [{ characterName: String(value.video_reference_name || "").trim(), description: "" }]
        : [];
  } catch {
    return NextResponse.json({ error: "Character guidance metadata must be a valid list." }, { status: 400 });
  }
  if (!Array.isArray(videoReferenceMetadata) || videoReferenceMetadata.length !== videoReferences.length)
    return NextResponse.json({ error: "Every AI-extracted guidance clip needs matching character details." }, { status: 400 });
  if (videoReferenceMetadata.some((item) => !item || typeof item.characterName !== "string" || !item.characterName.trim() || item.characterName.trim().length > 80 || typeof item.description !== "string" || !item.description.trim() || item.description.trim().length > 2000))
    return NextResponse.json({ error: "Give every guidance clip a character name and description." }, { status: 400 });
  videoReferenceMetadata = videoReferenceMetadata.map((item) => ({ characterName:item.characterName.trim(), description:item.description.trim() }));
  const dialogue = String(value.dialogue || "").trim();
  const audioDirection = String(value.audio_direction || "").trim();
  if (dialogue.length > 4000 || audioDirection.length > 2000)
    return NextResponse.json({ error: "Dialogue must be 4,000 characters or fewer and audio direction 2,000 characters or fewer." }, { status: 400 });
  const consistencyGuardrails = String(value.consistency_guardrails) !== "false";
  const requestValue: any = {
    prompt: value.prompt.trim(),
    dialogue: dialogue || undefined,
    audioDirection: audioDirection || undefined,
    consistencyGuardrails,
    model,
    seconds,
    size: value.size,
  };
  if (characters.length) requestValue.characters = characters.map((character) => ({ id: character.provider_character_id, name: character.name, description: character.description }));
  requestValue.finalPrompt = buildSoraPrompt({
    prompt: requestValue.prompt,
    dialogue,
    audioDirection,
    consistencyGuardrails,
    characters: requestValue.characters,
    extractedCharacters: videoReferenceMetadata.map((item) => ({ name:item.characterName,description:item.description })),
  });
  const id = createJob(requestValue, estimateVideoCents(model, value.size, seconds));
  if (reference) {
    const target = path.join(generationDir(id), `reference${imageTypes.get(reference.type)}`);
    await BunlessWrite(target, reference);
    requestValue.reference = { name: reference.name, type: reference.type, path: target };
    const { db } = await import("../../../lib/generation-store");
    db.prepare("UPDATE jobs SET request_json=? WHERE id=?").run(JSON.stringify(requestValue), id);
    writeManifest(id);
  }
  if (videoReferences.length) {
    requestValue.videoReferences = [];
    for (const [index, videoReference] of videoReferences.entries()) {
      const target = path.join(generationDir(id), `reference-original-${index + 1}.mp4`);
      await BunlessWrite(target, videoReference);
      requestValue.videoReferences.push({ name:videoReference.name,type:"video/mp4",path:target,...videoReferenceMetadata[index] });
    }
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
