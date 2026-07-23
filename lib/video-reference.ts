import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const ffmpegPath = process.env.FFMPEG_PATH || path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const CHARACTERS_URL = "https://api.openai.com/v1/videos/characters";

type PreparedCharacter = { id: string; selectedStart: number; selectedDuration: number; path: string };

function auth() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  return { Authorization: `Bearer ${key}` };
}

function apiMessage(payload: any, fallback: string) {
  return payload?.error?.message || fallback;
}

export async function inspectVideoMetadata(videoPath: string) {
  if (!existsSync(ffmpegPath)) throw new Error("The bundled video processor is unavailable.");
  let output = "";
  try {
    const result = await runFile(ffmpegPath, ["-hide_banner", "-i", videoPath, "-f", "null", "-"], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    output = `${result.stderr}\n${result.stdout}`;
  } catch (cause: any) {
    output = `${cause?.stderr || ""}\n${cause?.stdout || ""}`;
  }
  const durationMatch = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(output);
  const sizeMatch = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(output);
  if (!durationMatch || !sizeMatch) throw new Error("The MP4 clip metadata could not be determined.");
  return {
    duration: Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]),
    width: Number(sizeMatch[1]),
    height: Number(sizeMatch[2]),
  };
}

export async function inspectVideoDuration(videoPath: string) {
  return (await inspectVideoMetadata(videoPath)).duration;
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output || []).flatMap((item: any) => item?.content || []).map((item: any) => item?.text || "").join("\n");
}

async function chooseRelevantStart(videoPath: string, prompt: string, duration: number, workDir: string) {
  const maxStart = Math.max(0, Math.floor((duration - 4) * 2) / 2);
  if (maxStart <= 0) return 0;
  const sampleDir = path.join(workDir, "reference-samples");
  mkdirSync(sampleDir, { recursive: true });
  const timestamps = Array.from({ length: Math.floor(duration) + 1 }, (_, index) => Math.min(index, Math.max(0, duration - 0.05)));
  const content: any[] = [{
    type: "input_text",
    text: `Select the most useful continuous 4-second window from this reference clip for the requested generated-video prompt. Prefer the window whose visible subject, action, pose, styling, environment, and camera framing best support the prompt. Valid start_seconds values are multiples of 0.5 from 0 through ${maxStart}. Return only JSON like {"start_seconds": 2}. Prompt: ${prompt}`,
  }];
  try {
    for (const [index, timestamp] of timestamps.entries()) {
      const framePath = path.join(sampleDir, `frame-${index}.jpg`);
      await runFile(ffmpegPath, ["-y", "-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "3", framePath], { timeout: 30_000 });
      content.push({ type: "input_text", text: `Frame at ${timestamp.toFixed(1)} seconds:` });
      content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(framePath).toString("base64")}` });
    }
    const response = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4-mini", input: [{ role: "user", content }], max_output_tokens: 300 }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiMessage(payload, "The reference clip could not be compared with the prompt."));
    const parsed = JSON.parse(/\{[\s\S]*\}/.exec(responseText(payload))?.[0] || "{}");
    const requested = Number(parsed.start_seconds);
    if (!Number.isFinite(requested)) return 0;
    return Math.min(maxStart, Math.max(0, Math.round(requested * 2) / 2));
  } finally {
    rmSync(sampleDir, { recursive: true, force: true });
  }
}

export async function prepareCharacterReference(videoPath: string, prompt: string, workDir: string, characterName = "Reference subject"): Promise<PreparedCharacter> {
  const { duration, width, height } = await inspectVideoMetadata(videoPath);
  if (duration < 2 || duration > 8.05) throw new Error("Reference videos must be between 2 and 8 seconds long.");
  mkdirSync(workDir, { recursive: true });
  const selectedDuration = Math.min(4, duration);
  const selectedStart = await chooseRelevantStart(videoPath, prompt, duration, workDir);
  const trimmedPath = path.join(workDir, "reference-character.mp4");
  const targetSize = height > width ? "720:1280" : "1280:720";
  await runFile(ffmpegPath, [
    "-y", "-ss", String(selectedStart), "-i", videoPath, "-t", String(selectedDuration),
    "-map", "0:v:0", "-an", "-vf", `scale=${targetSize}:force_original_aspect_ratio=increase,crop=${targetSize},format=yuv420p`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast",
    "-crf", "18", "-movflags", "+faststart", trimmedPath,
  ], { timeout: 120_000 });
  const form = new FormData();
  form.set("name", characterName);
  form.set("video", new File([readFileSync(trimmedPath)], "reference-character.mp4", { type: "video/mp4" }));
  const response = await fetch(CHARACTERS_URL, { method: "POST", headers: auth(), body: form, signal: AbortSignal.timeout(120_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiMessage(payload, "OpenAI rejected the processed reference clip."));
  if (!payload?.id) throw new Error("OpenAI uploaded the reference clip but returned no character ID.");
  return { id: payload.id, selectedStart, selectedDuration, path: trimmedPath };
}
