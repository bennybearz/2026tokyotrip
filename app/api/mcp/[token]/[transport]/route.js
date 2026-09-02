import crypto from "crypto";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { readState, writeState } from "../../../../../lib/store";
import { applyAction } from "../../../../../lib/actions";
import { fetchAlbumPhotos, albumDebug } from "../../../../../lib/icloud";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Capability-URL auth: the MCP endpoint lives at /api/mcp/<MCP_TOKEN>/mcp.
// The token is a long random secret set in the MCP_TOKEN env var. If the env
// var is unset the endpoint is disabled entirely. Wrong/missing token => 404.
function tokenOk(token) {
  const expected = process.env.MCP_TOKEN;
  if (!expected || !token) return false;
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const text = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 1) }] });

// Strip photo payloads so tool results stay small.
function slimState(state) {
  return {
    tripName: state.tripName,
    updatedAt: state.updatedAt,
    ideas: state.ideas,
    days: state.days.map((d) => ({
      date: d.date,
      title: d.title,
      fixed: (d.fixed || []).map(slimItem),
      items: (d.items || []).map(slimItem),
    })),
    generalPhotoCount: (state.generalPhotos || []).length,
  };
}

function slimItem(i) {
  const { photos, ...rest } = i;
  return { ...rest, photoCount: (photos || []).length };
}

// All MCP tools run as admin — possession of the URL token IS the credential.
async function runAction(body) {
  const state = await readState();
  const result = await applyAction(state, body, "admin");
  if (result.error) return text({ error: result.error, status: result.status });
  if (!result.skipWrite) await writeState(state);
  return null; // caller decides what to return on success
}

function buildHandler(basePath) {
  return createMcpHandler(
    (server) => {
      server.tool(
        "get_state",
        "Read the full live trip state: days with itinerary items, all ideas (pending/approved/rejected, with approvedDay), and updatedAt. Photo payloads are omitted (counts only). Approved-but-unscheduled ideas are ideas where status==='approved' && !approvedDay.",
        {},
        async () => text(slimState(await readState()))
      );

      server.tool(
        "schedule_idea",
        "Place an approved-but-unscheduled idea onto a day. Creates a new itinerary item (source:'idea') on that day and sets the idea's approvedDay. Returns the new item so you can follow up with edit_item to enrich its note.",
        { id: z.string().describe("Idea id, e.g. idea-abc12-xyz"), date: z.string().describe("Day date YYYY-MM-DD") },
        async ({ id, date }) => {
          const err = await runAction({ type: "scheduleIdea", id, date });
          if (err) return err;
          const state = await readState();
          const day = state.days.find((d) => d.date === date);
          const item = [...day.items].reverse().find((i) => i.source === "idea");
          return text({ ok: true, newItem: slimItem(item) });
        }
      );

      server.tool(
        "edit_item",
        "Edit an itinerary item's name, note, and/or mapUrl. Omitted fields are left unchanged. Works on flexible and fixed items on any day.",
        {
          id: z.string().describe("Item id"),
          name: z.string().optional(),
          note: z.string().optional().describe("Max 600 chars"),
          mapUrl: z.string().optional().describe("Google Maps link"),
        },
        async ({ id, name, note, mapUrl }) => {
          const body = { type: "editItem", id };
          if (name !== undefined) body.name = name;
          if (note !== undefined) body.note = note;
          if (mapUrl !== undefined) body.mapUrl = mapUrl;
          const err = await runAction(body);
          return err || text({ ok: true });
        }
      );

      server.tool(
        "add_item",
        "Add a new itinerary item (source:'admin') to a day.",
        {
          date: z.string().describe("Day date YYYY-MM-DD"),
          name: z.string(),
          note: z.string().optional(),
          mapUrl: z.string().optional(),
        },
        async ({ date, name, note, mapUrl }) => {
          const err = await runAction({ type: "addItem", date, name, note, mapUrl });
          if (err) return err;
          const state = await readState();
          const day = state.days.find((d) => d.date === date);
          const item = day.items[day.items.length - 1];
          return text({ ok: true, newItem: slimItem(item) });
        }
      );

      server.tool(
        "get_album_photos",
        "List photos from the trip's iCloud Shared Album: guid, Tokyo capture time (takenAt) and day, contributor first name, caption, and current itemId assignment (null = general/day-level). Use timestamps + that day's itinerary order to infer which itinerary item each photo belongs to, then pin with assign_album_photo. No image data is returned.",
        {},
        async () => {
          const [photos, state] = await Promise.all([
            fetchAlbumPhotos({ withUrls: false }),
            readState(),
          ]);
          const assignments = state.albumAssignments || {};
          return text(
            photos.map((p) => ({
              guid: p.guid,
              takenAt: p.takenAt,
              day: p.day,
              by: p.by,
              caption: p.caption || undefined,
              itemId: assignments[p.guid] || null,
            }))
          );
        }
      );

      server.tool(
        "debug_album",
        "Diagnostics: raw iCloud album record type counts and field key names (no values). Use to verify the CloudKit feed parsing when get_album_photos looks wrong.",
        {},
        async () => text(await albumDebug())
      );

      server.tool(
        "assign_album_photo",
        "Pin an iCloud album photo to an itinerary item so it shows under that item on the dashboard. Pass toItemId:'general' (or omit) to unpin back to the general day feed.",
        {
          guid: z.string().describe("photo guid from get_album_photos"),
          toItemId: z.string().optional().describe("target item id, or 'general' to unpin"),
        },
        async ({ guid, toItemId }) => {
          const err = await runAction({ type: "assignAlbumPhoto", guid, toItemId });
          return err || text({ ok: true });
        }
      );

      server.tool(
        "import_ideas_from",
        "Selectively merge IDEAS from another live deployment of this dashboard into this one. Fetches the source's full state (gating in server-side with a viewer passphrase) and adds any ideas not already present locally (matched by id, or by name+suggester). Does NOT touch days, items, or photos. Imported ideas keep their status; approved-but-unscheduled ones can then be slotted with schedule_idea.",
        {
          url: z.string().describe("Base URL of the source deployment, e.g. https://weebathon.vercel.app"),
          gateWord: z.string().describe("A viewer passphrase accepted by the source site"),
        },
        async ({ url, gateWord }) => {
          const base = url.replace(/\/+$/, "");
          if (!/^https:\/\//.test(base)) return text({ error: "https URLs only" });
          const gateRes = await fetch(`${base}/api/gate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pass: gateWord }),
            cache: "no-store",
          });
          if (!gateRes.ok) return text({ error: `Gate failed (${gateRes.status})` });
          const cookie = (gateRes.headers.getSetCookie?.() || [gateRes.headers.get("set-cookie")].filter(Boolean))
            .map((c) => c.split(";")[0])
            .join("; ");
          if (!cookie) return text({ error: "Source did not set a gate cookie" });
          const stateRes = await fetch(`${base}/api/state`, { headers: { cookie }, cache: "no-store" });
          if (!stateRes.ok) return text({ error: `State read failed (${stateRes.status})` });
          const incoming = (await stateRes.json())?.state;
          if (!incoming || !Array.isArray(incoming.ideas)) {
            return text({ error: "Source state missing or malformed" });
          }
          const state = await readState();
          const key = (i) => `${(i.name || "").trim().toLowerCase()}|${(i.by || "").trim().toLowerCase()}`;
          const haveIds = new Set(state.ideas.map((i) => i.id));
          const haveKeys = new Set(state.ideas.map(key));
          // Also skip ideas whose name already exists as an itinerary item (already slotted here).
          const itemNames = new Set(
            state.days.flatMap((d) => [...(d.items || []), ...(d.fixed || [])]).map((i) => (i.name || "").trim().toLowerCase())
          );
          const added = [];
          const skipped = [];
          for (const idea of incoming.ideas) {
            if (haveIds.has(idea.id) || haveKeys.has(key(idea))) {
              skipped.push({ name: idea.name, reason: "already present" });
              continue;
            }
            if (idea.approvedDay && itemNames.has((idea.name || "").trim().toLowerCase())) {
              skipped.push({ name: idea.name, reason: "already slotted as item" });
              continue;
            }
            // Imported approved-but-scheduled ideas from the source arrive unscheduled
            // here (their day items were not copied) — clear approvedDay so they can be slotted.
            const copy = { ...idea };
            if (copy.status === "approved" && copy.approvedDay && !itemNames.has((copy.name || "").trim().toLowerCase())) {
              copy.approvedDay = null;
            }
            state.ideas.unshift(copy);
            added.push({ name: copy.name, by: copy.by, status: copy.status, approvedDay: copy.approvedDay });
          }
          if (added.length) await writeState(state);
          return text({ ok: true, added, skipped, sourceIdeaCount: incoming.ideas.length });
        }
      );

      server.tool(
        "import_state_from",
        "One-time migration: fetch the FULL state (days, items, photos, ideas) from another live deployment of this dashboard and overwrite this deployment's state with it. Gates in with a viewer passphrase server-side. Destructive: replaces the entire current state.",
        {
          url: z.string().describe("Base URL of the source deployment, e.g. https://2026tokyo.holub.life"),
          gateWord: z.string().describe("A viewer passphrase accepted by the source site"),
        },
        async ({ url, gateWord }) => {
          const base = url.replace(/\/+$/, "");
          if (!/^https:\/\//.test(base)) return text({ error: "https URLs only" });
          // 1) gate in to get the wt_gate cookie
          const gateRes = await fetch(`${base}/api/gate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pass: gateWord }),
            cache: "no-store",
          });
          if (!gateRes.ok) return text({ error: `Gate failed (${gateRes.status})` });
          const cookie = (gateRes.headers.getSetCookie?.() || [gateRes.headers.get("set-cookie")].filter(Boolean))
            .map((c) => c.split(";")[0])
            .join("; ");
          if (!cookie) return text({ error: "Source did not set a gate cookie" });
          // 2) read full state
          const stateRes = await fetch(`${base}/api/state`, {
            headers: { cookie },
            cache: "no-store",
          });
          if (!stateRes.ok) return text({ error: `State read failed (${stateRes.status})` });
          const payload = await stateRes.json();
          const incoming = payload?.state;
          if (!incoming || !Array.isArray(incoming.days) || !Array.isArray(incoming.ideas)) {
            return text({ error: "Source state missing or malformed", access: payload?.access });
          }
          // 3) overwrite local state
          await writeState(incoming);
          const photoCount =
            (incoming.generalPhotos || []).length +
            incoming.days.reduce(
              (n, d) =>
                n +
                [...(d.items || []), ...(d.fixed || [])].reduce(
                  (m, i) => m + (i.photos || []).length,
                  0
                ),
              0
            );
          return text({
            ok: true,
            imported: {
              tripName: incoming.tripName,
              days: incoming.days.length,
              items: incoming.days.reduce((n, d) => n + (d.items || []).length, 0),
              ideas: incoming.ideas.length,
              photos: photoCount,
              sourceUpdatedAt: incoming.updatedAt,
            },
            note: photoCount > 0 ? "Photo URLs still point at the source project's blob store — keep the old project alive or re-upload photos." : undefined,
          });
        }
      );

      server.tool(
        "move_item",
        "Move an itinerary item to a different day, keeping its id, source, attribution, photos and done-state intact. If the item came from an idea, that idea's approvedDay follows it automatically. Prefer this over delete_item + add_item, which loses attribution. Fixed (time-locked) items cannot be moved.",
        {
          id: z.string().describe("Item id"),
          toDate: z.string().describe("Destination day date YYYY-MM-DD"),
          position: z.number().int().optional().describe("Insert index within the destination day's items; appends if omitted"),
        },
        async ({ id, toDate, position }) => {
          const err = await runAction({ type: "moveItem", id, toDate, position });
          if (err) return err;
          const state = await readState();
          const day = state.days.find((d) => d.date === toDate);
          return text({ ok: true, day: { date: day.date, title: day.title }, items: day.items.map((i) => i.name) });
        }
      );

      server.tool(
        "set_day_title",
        "Rename a day's heading, and optionally its subtitle. Use after moving items between days so the day labels still describe what is actually on them.",
        {
          date: z.string().describe("Day date YYYY-MM-DD"),
          title: z.string().optional().describe("New heading, e.g. 'Day 3 · Shibuya'"),
          subtitle: z.string().optional().describe("Optional sub-heading; pass an empty string to clear"),
        },
        async ({ date, title, subtitle }) => {
          const body = { type: "setDayTitle", date };
          if (title !== undefined) body.title = title;
          if (subtitle !== undefined) body.subtitle = subtitle;
          const err = await runAction(body);
          if (err) return err;
          const state = await readState();
          const day = state.days.find((d) => d.date === date);
          return text({ ok: true, date: day.date, title: day.title, subtitle: day.subtitle || null });
        }
      );

      server.tool(
        "link_item_to_idea",
        "Repair the link between an itinerary item and the idea it came from: restores source:'idea' and the suggester's name on the item, and points the idea's approvedDay at the day the item actually sits on. Use when an item was rebuilt by hand and lost its attribution.",
        {
          itemId: z.string().describe("Item id"),
          ideaId: z.string().describe("Idea id, e.g. idea-abc12-xyz"),
        },
        async ({ itemId, ideaId }) => {
          const err = await runAction({ type: "linkItemToIdea", itemId, ideaId });
          if (err) return err;
          const state = await readState();
          const idea = state.ideas.find((i) => i.id === ideaId);
          return text({ ok: true, idea: { id: idea.id, name: idea.name, by: idea.by, approvedDay: idea.approvedDay } });
        }
      );

      server.tool(
        "reject_idea",
        "Retire an idea for good: sets status to 'rejected' so it leaves the approved pool and the sync routine stops considering it. Works on an idea in ANY status, including one already approved — this is the only way to un-approve, since the dashboard UI only offers Reject on pending ideas. If the idea still has an itinerary item, reject it FIRST and then call delete_item: deleting first releases the idea back into the approved-but-unscheduled pool, where the next sync run will research it and re-slot it onto a remaining day.",
        { id: z.string().describe("Idea id, e.g. idea-abc12-xyz") },
        async ({ id }) => {
          const err = await runAction({ type: "rejectIdea", id });
          if (err) return err;
          const state = await readState();
          const idea = state.ideas.find((i) => i.id === id);
          const stillScheduled = state.days
            .flatMap((d) => (d.items || []).map((i) => ({ date: d.date, item: i })))
            .filter(({ item }) => item.ideaId === id)
            .map(({ date, item }) => ({ date, itemId: item.id, name: item.name }));
          return text({
            ok: true,
            idea: {
              id: idea.id,
              name: idea.name,
              by: idea.by,
              status: idea.status,
              approvedDay: idea.approvedDay ?? null,
            },
            stillScheduled,
            note: stillScheduled.length
              ? "Idea is rejected but these items remain on the itinerary — delete_item them now if they should go too. Safe to delete in this order."
              : undefined,
          });
        }
      );

      server.tool(
        "delete_item",
        "Delete an itinerary item from a day (also removes its photos from storage). ⚠️ If it came from an idea, that idea is released back to the approved-but-unscheduled pool, which means the next sync run will re-slot it onto a remaining day — to retire something permanently, call reject_idea FIRST, then delete_item. To relocate an item, use move_item instead — deleting and re-adding loses its attribution and photos.",
        { date: z.string().describe("Day date YYYY-MM-DD"), id: z.string().describe("Item id") },
        async ({ date, id }) => {
          const err = await runAction({ type: "deleteItem", date, id });
          return err || text({ ok: true });
        }
      );
    },
    {
      serverInfo: { name: "weeb-trip-dashboard", version: "1.0.0" },
    },
    {
      basePath,
      verboseLogs: false,
    }
  );
}

async function handle(req, { params }) {
  const { token } = await params;
  if (!tokenOk(token)) return new Response("Not found", { status: 404 });
  const handler = buildHandler(`/api/mcp/${token}`);
  return handler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
