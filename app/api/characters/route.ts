import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { createCharacterFromImage } from "../../../lib/character-service";
import { db, listCharacters } from "../../../lib/generation-store";

export const runtime = "nodejs";
const imageTypes = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const characterRoot = path.join(process.env.SORA_DATA_DIR || path.join(process.cwd(), ".data"), "characters");

const serialize = (row: any) => ({ id: row.id, characterId: row.provider_character_id, name: row.name, description: row.description, createdAt: row.created_at });

export async function GET() {
  return NextResponse.json({ characters: listCharacters().map(serialize), limit: 5, maxPerGeneration: 2 });
}

export async function POST(request: NextRequest) {
  if (listCharacters().length >= 5) return NextResponse.json({ error: "The character library can contain up to 5 character IDs." }, { status: 409 });
  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const description = String(form.get("description") || "").trim();
  const candidate = form.get("image");
  const image = candidate instanceof File && candidate.size ? candidate : null;
  if (!name || name.length > 80) return NextResponse.json({ error: "Enter a character name of 80 characters or fewer." }, { status: 400 });
  if (!description || description.length > 2000) return NextResponse.json({ error: "Enter a character description of 2,000 characters or fewer." }, { status: 400 });
  if (!image || !imageTypes.has(image.type) || image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Choose a JPEG, PNG, or WebP image no larger than 20 MB." }, { status: 400 });
  const id = crypto.randomUUID();
  const directory = path.join(characterRoot, id);
  await mkdir(directory, { recursive: true });
  const imagePath = path.join(directory, `reference${imageTypes.get(image.type)}`);
  const videoPath = path.join(directory, "character-source.mp4");
  await writeFile(imagePath, Buffer.from(await image.arrayBuffer()), { mode: 0o600 });
  try {
    const characterId = await createCharacterFromImage(imagePath, videoPath, name);
    const timestamp = new Date().toISOString();
    db.prepare("INSERT INTO characters(id,provider_character_id,name,description,image_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, characterId, name, description, imagePath, timestamp, timestamp);
    return NextResponse.json({ character: serialize({ id, provider_character_id: characterId, name, description, created_at: timestamp }) }, { status: 201 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Character creation failed." }, { status: 400 });
  }
}
