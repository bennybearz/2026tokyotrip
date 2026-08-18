import { NextResponse } from "next/server";
import { readState } from "../../../lib/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Public read-only feed used to sync approved items into Tripsy.
// Contains only the itinerary (already public in the dashboard) — no auth data.
export async function GET() {
  const state = await readState();
  const body = {
    tripName: state.tripName,
    updatedAt: state.updatedAt || null,
    days: state.days.map((d) => ({
      date: d.date,
      title: d.title,
      fixed: (d.fixed || []).map((f) => ({
        id: f.id,
        name: f.name,
        time: f.time,
        done: f.done || null,
      })),
      items: d.items.map((i) => ({
        id: i.id,
        name: i.name,
        note: i.note || "",
        mapUrl: i.mapUrl || null,
        source: i.source || "seed",
        approvedAt: i.approvedAt || null,
        suggestedBy: i.suggestedBy || null,
        done: i.done || null,
      })),
    })),
    pendingIdeas: state.ideas.filter((i) => i.status === "pending").length,
    approvedUnscheduled: state.ideas
      .filter((i) => i.status === "approved" && !i.approvedDay)
      .map((i) => ({ id: i.id, name: i.name, note: i.note || "", by: i.by, decidedAt: i.decidedAt })),
  };
  // Defeat any CDN / proxy / fetch caching so the sync always reads live state.
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}
