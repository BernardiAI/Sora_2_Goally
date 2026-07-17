import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "OPENAI_API_KEY is not configured in .env.local." }, { status: 503 });
  const { id } = await params;
  const range = request.headers.get("range");
  const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(id)}/content`, {
    headers: { Authorization: `Bearer ${key}`, ...(range ? { Range: range } : {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json({ error: payload?.error?.message ?? "Video content is not available yet." }, { status: response.status });
  }
  const headers = new Headers({
    "Content-Type": response.headers.get("content-type") ?? "video/mp4",
    "Cache-Control": "private, max-age=3600",
  });
  for (const name of ["accept-ranges", "content-length", "content-range"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(response.body, { status: response.status, headers });
}
