import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import path from "node:path";
import { db, generationDir, importProviderJob, jobById, jobByProviderId, transition } from "./generation-store";
import { logEvent } from "./telemetry";
import { providerVideoSeconds } from "./video-config";
import { prepareCharacterReference } from "./video-reference";

const VIDEOS_URL = "https://api.openai.com/v1/videos";
const ffmpegPath = process.env.FFMPEG_PATH || path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
const runFile = promisify(execFile);
const auth = () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error("OPENAI_API_KEY is not configured."), { code: "missing_api_key" });
  return { Authorization: `Bearer ${key}` };
};
const message = (payload: any, fallback: string) => payload?.error?.message || fallback;

function providerStatus(video: any) {
  if (video.status === "completed") return "completed";
  if (video.status === "failed") return video.error?.code === "moderation_blocked" ? "moderation_blocked" : "failed";
  if (video.status === "cancelled") return "cancelled";
  return video.status === "in_progress" ? "in_progress" : "queued";
}

export async function submitJob(jobId: string) {
  const job = jobById(jobId);
  if (!job || job.status !== "draft") return;
  const request = JSON.parse(job.request_json);
  const renderSeconds = providerVideoSeconds(request.seconds);
  const attemptId = crypto.randomUUID();
  transition(jobId, "submitting", "worker");
  db.prepare("INSERT INTO provider_attempts(id,job_id,operation,started_at,client_request_id) VALUES (?,?,?,?,?)").run(attemptId,jobId,"submit",new Date().toISOString(),job.client_request_id);
  let character: Awaited<ReturnType<typeof prepareCharacterReference>> | null = null;
  if (request.videoReference?.path) {
    try {
      character = await prepareCharacterReference(request.videoReference.path, request.prompt, generationDir(jobId));
      request.videoReference = { ...request.videoReference, selectedStart: character.selectedStart, selectedDuration: character.selectedDuration, characterId: character.id };
      db.prepare("UPDATE jobs SET request_json=? WHERE id=?").run(JSON.stringify(request), jobId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "The reference video could not be prepared.";
      transition(jobId, "failed", "reference_processor", { error_code: "reference_video_failed", error_message: errorMessage });
      db.prepare("UPDATE provider_attempts SET finished_at=?,outcome=?,error_code=?,error_message=? WHERE id=?").run(new Date().toISOString(),"rejected","reference_video_failed",errorMessage,attemptId);
      logEvent("error","reference_video.failed",{jobId,error:errorMessage});
      return;
    }
  }
  let response: Response;
  try {
    const headers: Record<string,string> = { ...auth(), "X-Client-Request-Id": job.client_request_id };
    let body: FormData | string;
    if (request.reference?.path || character || request.characters?.length) {
      headers["Content-Type"] = "application/json";
      const storedCharacters = request.characters || [];
      const characterGuidance = storedCharacters.map((item: any) => `${item.name}: ${item.description}`).join("\n");
      const payload: any = {
        model: request.model,
        prompt: `${request.prompt}${character ? "\n\nKeep Reference subject visually consistent with the uploaded character clip." : ""}${characterGuidance ? `\n\nKeep these named characters visually consistent:\n${characterGuidance}` : ""}`,
        seconds: renderSeconds,
        size: request.size,
      };
      if (request.reference?.path) {
        const image = readFileSync(request.reference.path).toString("base64");
        payload.input_reference = { image_url: `data:${request.reference.type};base64,${image}` };
      }
      const characterPayload = [...storedCharacters.map((item: any) => ({ id: item.id })), ...(character ? [{ id: character.id }] : [])];
      if (characterPayload.length) payload.characters = characterPayload;
      body = JSON.stringify(payload);
    } else {
      const form = new FormData();
      form.set("model", request.model); form.set("prompt", request.prompt); form.set("seconds", renderSeconds); form.set("size", request.size);
      body = form;
    }
    response = await fetch(VIDEOS_URL, {
      method: "POST", headers, body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Submission connection failed.";
    transition(jobId, "submission_unknown", "worker", { error_code: "submission_unknown", error_message: errorMessage });
    db.prepare("UPDATE provider_attempts SET finished_at=?,outcome=?,error_code=?,error_message=? WHERE id=?").run(new Date().toISOString(),"unknown","submission_unknown",errorMessage,attemptId);
    logEvent("error","generation.submission_unknown",{jobId,clientRequestId:job.client_request_id,error:errorMessage});
    return;
  }
  const providerRequestId = response.headers.get("x-request-id");
  const payload = await response.json().catch(() => null);
  db.prepare("UPDATE provider_attempts SET finished_at=?,http_status=?,provider_request_id=?,outcome=?,error_code=?,error_message=? WHERE id=?")
    .run(new Date().toISOString(),response.status,providerRequestId,response.ok?"accepted":"rejected",payload?.error?.code || null,response.ok?null:message(payload,"Video request failed."),attemptId);
  if (!response.ok) {
    const code = payload?.error?.code || `provider_http_${response.status}`;
    transition(jobId, code === "moderation_blocked" ? "moderation_blocked" : "failed", "provider", { provider_request_id: providerRequestId, provider_http_status: response.status, error_code: code, error_message: message(payload,"Video request failed.") });
    return;
  }
  if (!payload?.id) {
    transition(jobId,"submission_unknown","provider",{provider_request_id:providerRequestId,provider_http_status:response.status,error_code:"invalid_provider_response",error_message:"OpenAI accepted the request but returned no video id."});
    return;
  }
  transition(jobId, providerStatus(payload), "provider", { provider_video_id: payload.id, provider_request_id: providerRequestId, provider_http_status: response.status, progress: payload.progress || 0, provider_created_at: payload.created_at || null, provider_expires_at: payload.expires_at || null });
  logEvent("info","generation.accepted",{jobId,providerVideoId:payload.id,providerRequestId,requestedModel:request.model,providerModel:payload.model??null,requestedSize:request.size,providerSize:payload.size??null,requestedSeconds:request.seconds,providerSeconds:payload.seconds??renderSeconds});
}

export async function reconcileJob(jobId: string) {
  const job = jobById(jobId);
  if (!job?.provider_video_id) return;
  const response = await fetch(`${VIDEOS_URL}/${encodeURIComponent(job.provider_video_id)}`, { headers: auth(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404 && job.provider_expires_at && job.provider_expires_at * 1000 < Date.now()) transition(jobId,"expired","provider",{error_code:"provider_asset_expired",error_message:"The provider no longer has this video."});
    else logEvent("warn","generation.reconcile_failed",{jobId,httpStatus:response.status,error:message(payload,"Unable to retrieve video.")});
    return;
  }
  const status = providerStatus(payload);
  const localStatus = status === "completed" && job.status === "ready" ? "ready" : status;
  transition(jobId,localStatus,"provider",{progress:payload.progress || 0,provider_created_at:payload.created_at || null,provider_completed_at:payload.completed_at || null,provider_expires_at:payload.expires_at || null,error_code:payload.error?.code || null,error_message:payload.error?.message || null,last_reconciled_at:new Date().toISOString()});
  if (status === "completed") await archiveJob(jobId);
}

export async function archiveJob(jobId: string) {
  const job = jobById(jobId);
  if (!job?.provider_video_id) return;
  const currentAsset = db.prepare("SELECT * FROM assets WHERE job_id=?").get(jobId) as any;
  if (currentAsset?.verified && currentAsset.path && existsSync(currentAsset.path)) { transition(jobId,"ready","archive"); return; }
  transition(jobId,"archiving","archive");
  const finalPath = path.join(generationDir(jobId), "output.mp4");
  const tempPath = `${finalPath}.${crypto.randomUUID()}.part`;
  const trimmedPath = `${finalPath}.${crypto.randomUUID()}.trim.mp4`;
  const assetId = currentAsset?.id || crypto.randomUUID();
  db.prepare(`INSERT INTO assets(id,job_id,temp_path,attempt_count,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(job_id) DO UPDATE SET temp_path=excluded.temp_path,attempt_count=assets.attempt_count+1,updated_at=excluded.updated_at`).run(assetId,jobId,tempPath,1,new Date().toISOString(),new Date().toISOString());
  try {
    const response = await fetch(`${VIDEOS_URL}/${encodeURIComponent(job.provider_video_id)}/content`, { headers: auth(), cache:"no-store", signal:AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Asset download failed with HTTP ${response.status}.`);
    const mime = response.headers.get("content-type") || "";
    if (!mime.startsWith("video/")) throw new Error(`Unexpected asset content type: ${mime || "missing"}.`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(tempPath,{flags:"wx",mode:0o600}));
    if (!statSync(tempPath).size) throw new Error("Downloaded asset was empty.");
    const request = JSON.parse(job.request_json);
    const renderSeconds = providerVideoSeconds(request.seconds);
    let archivedPath = tempPath;
    if (request.seconds !== renderSeconds) {
      if (!existsSync(ffmpegPath)) throw new Error(`The bundled video trimmer was not found at ${ffmpegPath}.`);
      // The provider only renders 4, 8, or 12 seconds. Keep custom whole-second
      // durations without recompressing Sora's output, which preserves its exact
      // video and audio quality.
      await runFile(ffmpegPath, ["-y","-i",tempPath,"-t",request.seconds,"-map","0","-c","copy","-movflags","+faststart",trimmedPath], { timeout: 120_000 });
      unlinkSync(tempPath);
      archivedPath = trimmedPath;
    }
    const bytes = statSync(archivedPath).size;
    if (!bytes) throw new Error("Processed asset was empty.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archivedPath)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    renameSync(archivedPath,finalPath);
    db.prepare("UPDATE assets SET path=?,temp_path=NULL,mime_type=?,byte_count=?,sha256=?,verified=1,last_error=NULL,updated_at=? WHERE job_id=?").run(finalPath,mime,bytes,sha256,new Date().toISOString(),jobId);
    transition(jobId,"ready","archive");
    logEvent("info","asset.archived",{jobId,path:finalPath,bytes,sha256});
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    if (existsSync(trimmedPath)) unlinkSync(trimmedPath);
    const errorMessage = error instanceof Error ? error.message : "Asset archival failed.";
    db.prepare("UPDATE assets SET temp_path=NULL,last_error=?,updated_at=? WHERE job_id=?").run(errorMessage,new Date().toISOString(),jobId);
    transition(jobId,"archive_failed","archive",{error_code:"archive_failed",error_message:errorMessage});
    logEvent("error","asset.archive_failed",{jobId,error:errorMessage});
  }
}

export async function reconcileAll() {
  let after: string | undefined;
  do {
    const url = new URL(VIDEOS_URL); url.searchParams.set("limit","100"); url.searchParams.set("order","asc"); if (after) url.searchParams.set("after",after);
    const response = await fetch(url,{headers:auth(),cache:"no-store",signal:AbortSignal.timeout(30_000)});
    const payload = await response.json().catch(()=>null);
    if (!response.ok) throw new Error(message(payload,`Provider reconciliation failed with HTTP ${response.status}.`));
    const videos = payload?.data || [];
    for (const video of videos) {
      const jobId = jobByProviderId(video.id)?.id || importProviderJob(video);
      const status = providerStatus(video);
      const existing = jobByProviderId(video.id);
      const localStatus = status === "completed" && existing?.status === "ready" ? "ready" : status;
      transition(jobId,localStatus,"provider_recovery",{progress:video.progress || 0,provider_created_at:video.created_at || null,provider_completed_at:video.completed_at || null,provider_expires_at:video.expires_at || null,error_code:video.error?.code || null,error_message:video.error?.message || null,last_reconciled_at:new Date().toISOString()});
      if (status === "completed") await archiveJob(jobId);
    }
    after = payload?.has_more && videos.length ? videos[videos.length-1].id : undefined;
  } while (after);
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO app_state VALUES ('last_reconciliation',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(timestamp,timestamp);
  logEvent("info","reconciliation.completed",{timestamp});
}
