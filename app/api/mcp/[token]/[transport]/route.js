import crypto from "crypto";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { readState, writeState } from "../../../../../lib/store";
import { applyAction } from "../../../../../lib/actions";

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
        "delete_item",
        "Delete an itinerary item from a day (also removes its photos from storage).",
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
