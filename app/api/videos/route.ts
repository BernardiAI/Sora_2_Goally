import { NextRequest, NextResponse } from "next/server";
import { isValidVideoRequest, providerVideoSeconds, type VideoModel, type VideoSeconds } from "../../../lib/video-config";

const OPENAI_VIDEOS_URL = "https://api.openai.com/v1/videos";

function authHeaders() {
  const key = process.env.OPENAI_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : null;
}

export async function POST(request: NextRequest) {
  const headers = authHeaders();
  if (!headers) return NextResponse.json({ error: "OPENAI_API_KEY is not configured in .env.local." }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ error: "A prompt is required." }, { status: 400 });
  const seconds = String(body.seconds ?? "4");
  const model: VideoModel = body.model === "sora-2-pro" ? "sora-2-pro" : "sora-2";
  const size = typeof body.size === "string" ? body.size : "1280x720";
  const candidate = { prompt,model,seconds,size };
  if (!isValidVideoRequest(candidate)) return NextResponse.json({ error: "Model, duration, and resolution must be a supported combination." }, { status: 400 });
  const response = await fetch(OPENAI_VIDEOS_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, seconds: providerVideoSeconds(seconds as VideoSeconds), size }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: payload?.error?.message ?? "OpenAI video request failed." }, { status: response.status });
  return NextResponse.json({ id: payload.id, status: payload.status ?? "queued" });
}

export async function GET(request: NextRequest) {
  const headers = authHeaders();
  if (!headers) return NextResponse.json({ error: "OPENAI_API_KEY is not configured in .env.local." }, { status: 503 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "A video id is required." }, { status: 400 });
  const response = await fetch(`${OPENAI_VIDEOS_URL}/${encodeURIComponent(id)}`, { headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: payload?.error?.message ?? "Unable to read video status." }, { status: response.status });
  return NextResponse.json({ id: payload.id, status: payload.status, progress: payload.progress ?? 0, error: payload.error?.message });
}
