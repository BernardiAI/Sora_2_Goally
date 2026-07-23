import { rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../lib/generation-store";

export const runtime = "nodejs";

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = db.prepare("SELECT image_path FROM characters WHERE id=?").get(id) as { image_path: string } | undefined;
  if (!row) return NextResponse.json({ error: "Character not found." }, { status: 404 });
  db.prepare("DELETE FROM characters WHERE id=?").run(id);
  await rm(path.dirname(row.image_path), { recursive: true, force: true });
  return NextResponse.json({ deleted: true });
}
