import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const ffmpegPath = process.env.FFMPEG_PATH || path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
const CHARACTERS_URL = "https://api.openai.com/v1/videos/characters";

function auth() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  return { Authorization: `Bearer ${key}` };
}

export async function createCharacterFromVideo(videoPath: string, outputPath: string, name: string, portrait: boolean) {
  const targetSize = portrait ? "720:1280" : "1280:720";
  await runFile(ffmpegPath, [
    "-y", "-i", videoPath, "-t", "4",
    "-map", "0:v:0", "-an", "-vf", `scale=${targetSize}:force_original_aspect_ratio=increase,crop=${targetSize},format=yuv420p`,
    "-r", "24", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-movflags", "+faststart", outputPath,
  ], { timeout: 120_000 });
  const form = new FormData();
  form.set("name", name);
  form.set("video", new File([readFileSync(outputPath)], `${name}.mp4`, { type: "video/mp4" }));
  const response = await fetch(CHARACTERS_URL, { method: "POST", headers: auth(), body: form, signal: AbortSignal.timeout(120_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || "OpenAI rejected the character reference.");
  if (!payload?.id) throw new Error("OpenAI created the character but returned no character ID.");
  return payload.id as string;
}
