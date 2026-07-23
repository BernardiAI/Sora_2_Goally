import { NextRequest, NextResponse } from "next/server";
import { createJob, jobById, serializeJob } from "../../../lib/generation-store";
import { submitJob } from "../../../lib/generation-service";
import { ensureWorker } from "../../../lib/worker";
import { buildContinuityPrompt, validateDialogue, type PromptCharacter } from "../../../lib/sora-prompt";
import { estimateVideoCents, VIDEO_SECONDS, videoRateCents, type VideoSeconds } from "../../../lib/video-config";

export const runtime = "nodejs";

function sourceCharacters(request: any): PromptCharacter[] {
  const saved = (request.characters || []).map((item: any) => ({ name: item.name, description: item.description }));
  const extracted = (request.videoReferences?.length
    ? request.videoReferences
    : request.videoReference
      ? [request.videoReference]
      : []).map((item: any) => ({ name: item.characterName || "Reference subject", description: item.description }));
  return [...saved, ...extracted];
}

export async function POST(request: NextRequest) {
  ensureWorker();
  const value = await request.json().catch(() => null);
  const mode = value?.mode;
  const prompt = typeof value?.prompt === "string" ? value.prompt.trim() : "";
  if ((mode !== "extend" && mode !== "edit") || !prompt || typeof value?.sourceJobId !== "string")
    return NextResponse.json({ error: "Choose a completed source clip, a continuity operation, and describe the next scene or targeted edit." }, { status: 400 });

  const source = jobById(value.sourceJobId);
  if (!source || source.status !== "ready" || !source.provider_video_id)
    return NextResponse.json({ error: "The source must be a completed Sora clip with an available provider video ID." }, { status: 400 });
  if (source.provider_expires_at && source.provider_expires_at * 1000 <= Date.now())
    return NextResponse.json({ error: "This Sora source has expired at the provider and can no longer be continued or edited." }, { status: 410 });

  const sourceRequest = JSON.parse(source.request_json);
  const sourceTotalSeconds = Number(sourceRequest.totalSeconds ?? sourceRequest.seconds);
  if (!Number.isFinite(sourceTotalSeconds) || sourceTotalSeconds <= 0)
    return NextResponse.json({ error: "The source clip duration is unavailable." }, { status: 400 });

  const dialogue = typeof value.dialogue === "string" ? value.dialogue.trim() : "";
  const audioDirection = typeof value.audioDirection === "string" ? value.audioDirection.trim() : "";
  const dialogueError = validateDialogue(dialogue);
  if (dialogueError) return NextResponse.json({ error: dialogueError }, { status: 400 });
  if (dialogue.length > 4000 || audioDirection.length > 2000)
    return NextResponse.json({ error: "Dialogue must be 4,000 characters or fewer and audio direction 2,000 characters or fewer." }, { status: 400 });

  const currentDepth = Number(sourceRequest.continuity?.extensionDepth ?? 0);
  let seconds = String(value.seconds || "4") as VideoSeconds;
  let totalSeconds = sourceTotalSeconds;
  let extensionDepth = currentDepth;
  if (mode === "extend") {
    if (!VIDEO_SECONDS.includes(seconds))
      return NextResponse.json({ error: "Choose a continuation length from 3 to 20 seconds." }, { status: 400 });
    extensionDepth += 1;
    totalSeconds += Number(seconds);
    if (extensionDepth > 6)
      return NextResponse.json({ error: "Sora allows at most six extensions in one continuity chain." }, { status: 400 });
    if (totalSeconds > 120)
      return NextResponse.json({ error: "A Sora continuity chain cannot exceed 120 seconds." }, { status: 400 });
  } else {
    seconds = sourceRequest.seconds;
  }

  const consistencyGuardrails = value.consistencyGuardrails !== false;
  const characters = sourceCharacters(sourceRequest);
  const finalPrompt = buildContinuityPrompt({
    mode,
    prompt,
    dialogue,
    audioDirection,
    consistencyGuardrails,
    characters,
  });
  const chainRootJobId = sourceRequest.continuity?.chainRootJobId || source.id;
  const requestValue: any = {
    prompt,
    finalPrompt,
    dialogue: dialogue || undefined,
    audioDirection: audioDirection || undefined,
    consistencyGuardrails,
    model: sourceRequest.model,
    seconds,
    totalSeconds,
    size: sourceRequest.size,
    continuity: {
      mode,
      sourceJobId: source.id,
      sourceProviderVideoId: source.provider_video_id,
      chainRootJobId,
      extensionDepth,
      sourceTotalSeconds,
      ...(mode === "extend" ? { appendedSeconds: seconds } : {}),
    },
  };
  const estimatedCents = mode === "extend"
    ? estimateVideoCents(sourceRequest.model, sourceRequest.size, seconds)
    : videoRateCents(sourceRequest.model, sourceRequest.size) * sourceTotalSeconds;
  const id = createJob(requestValue, Math.round(estimatedCents));
  await submitJob(id);
  return NextResponse.json({ job: serializeJob(jobById(id)) }, { status: 201 });
}
