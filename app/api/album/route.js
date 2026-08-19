import { NextResponse } from "next/server";
import { readState } from "../../../lib/store";
import { hasGateAccess } from "../../../lib/auth";
import { fetchAlbumPhotos, resolveAssetUrls } from "../../../lib/icloud";

export const dynamic = "force-dynamic";

// Photos from the iCloud Shared Album, with fresh signed URLs and any
// item assignments (state.albumAssignments: { photoGuid: itemId }).
export async function GET() {
  if (!(await hasGateAccess())) return NextResponse.json({ photos: [] });
  try {
    const [photos, state] = await Promise.all([fetchAlbumPhotos(), readState()]);
    if (!photos.length) return NextResponse.json({ photos: [] });
    const urls = await resolveAssetUrls(photos.map((p) => p.guid));
    const assignments = state.albumAssignments || {};
    const out = photos
      .map((p) => ({
        guid: p.guid,
        url: urls[p.checksum] || null,
        by: p.by,
        caption: p.caption,
        takenAt: p.takenAt,
        day: p.day,
        width: p.width,
        height: p.height,
        itemId: assignments[p.guid] || null,
      }))
      .filter((p) => p.url);
    return NextResponse.json(
      { photos: out },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ photos: [], error: String(e.message || e) });
  }
}
