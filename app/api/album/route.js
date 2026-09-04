import { NextResponse } from "next/server";
import { readState } from "../../../lib/store";
import { hasGateAccess } from "../../../lib/auth";
import { fetchAlbumPhotos, albumDebug } from "../../../lib/icloud";

export const dynamic = "force-dynamic";

// Photos from the iCloud Shared Album, with fresh signed URLs and any
// item assignments (state.albumAssignments: { photoGuid: itemId }).
export async function GET(req) {
  if (!(await hasGateAccess())) return NextResponse.json({ photos: [] });
  try {
    if (new URL(req.url).searchParams.get("debug") === "1") {
      return NextResponse.json({ debug: await albumDebug() });
    }
    const [photos, state] = await Promise.all([fetchAlbumPhotos(), readState()]);
    const assignments = state.albumAssignments || {};
    // A pin may have been made against a copy we collapsed away.
    const itemFor = (p) => {
      if (assignments[p.guid]) return assignments[p.guid];
      for (const g of p.dupeGuids || []) if (assignments[g]) return assignments[g];
      return null;
    };
    const out = photos
      .filter((p) => p.url)
      .map((p) => ({
        guid: p.guid,
        url: p.url,
        thumb: p.thumb || p.url,
        by: p.by,
        caption: p.caption,
        takenAt: p.takenAt,
        day: p.day,
        itemId: itemFor(p),
      }));
    return NextResponse.json(
      { photos: out },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ photos: [], error: String(e.message || e) });
  }
}
