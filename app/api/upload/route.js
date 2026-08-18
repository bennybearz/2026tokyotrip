import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { readState, writeState, findItem } from "../../../lib/store";
import { currentRole } from "../../../lib/auth";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

export async function POST(req) {
  const role = await currentRole();
  if (!["crew", "admin"].includes(role)) {
    return NextResponse.json({ error: "Enter the crew PIN to upload photos" }, { status: 403 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Photo storage not configured (connect a Vercel Blob store)" },
      { status: 500 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  // "general" (or empty) = a trip photo not tied to any itinerary item
  const itemId = String(form.get("itemId") || "general");
  const by = String(form.get("by") || "").trim().slice(0, 40) || "someone";

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Max 10 MB per photo" }, { status: 400 });
  }
  if (!OK_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Images only" }, { status: 400 });
  }

  const state = await readState();
  let target = null;
  if (itemId === "general") {
    state.generalPhotos = state.generalPhotos || [];
    target = state.generalPhotos;
  } else {
    const found = findItem(state, itemId);
    if (!found) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    found.item.photos = found.item.photos || [];
    target = found.item.photos;
  }

  const ext = (file.name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const blob = await put(`photos/${itemId}/${Date.now()}.${ext}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  target.push({
    url: blob.url,
    by,
    at: new Date().toISOString(),
  });

  await writeState(state);
  return NextResponse.json({ ok: true, state, role });
}
