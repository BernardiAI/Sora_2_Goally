import { readFileSync } from "node:fs";

type ReferencePhoto = { name: string; type: string; path: string };

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output || []).flatMap((item: any) => item?.content || []).map((part: any) => part?.text || "").join("\n").trim();
}

export async function createReferencePhotoGuidance(photos: ReferencePhoto[], prompt: string) {
  if (!photos.length) return "";
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  const content: any[] = [{
    type: "input_text",
    text: `Analyze these ${photos.length} non-opening visual reference photos for a Sora 2 Pro video. Extract only concrete, visible details that help the requested shot: subject appearance, clothing, objects, environment, materials, color palette, lighting, and style. Reconcile repeated views of the same subject. Do not describe framing as an opening frame, do not invent identities or unseen details, and do not copy text or watermarks. Return one compact paragraph titled VISUAL REFERENCE GUIDANCE that can be appended to this video prompt:\n\n${prompt}`,
  }];
  for (const photo of photos) {
    const encoded = readFileSync(photo.path).toString("base64");
    content.push({ type: "input_image", image_url: `data:${photo.type};base64,${encoded}`, detail: "original" });
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.6", input: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || "Reference photos could not be analyzed.");
  const guidance = outputText(payload);
  if (!guidance) throw new Error("Reference photo analysis returned no visual guidance.");
  return guidance;
}
