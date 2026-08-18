import { findItem, newId, deleteBlobUrl } from "./store";

const clean = (s, max = 500) => String(s || "").trim().slice(0, max);

// Shared action executor used by the cookie-auth /api/action route and the
// token-auth /api/mcp route. Mutates `state` in place.
// Returns { ok: true } or { error, status }.
export async function applyAction(state, body, role) {
  const { type } = body;

  const adminOnly = () => (role !== "admin" ? { error: "Admin only", status: 403 } : null);

  switch (type) {
    // Anyone (public) can suggest an idea.
    case "submitIdea": {
      const name = clean(body.name, 120);
      const note = clean(body.note, 600);
      const by = clean(body.by, 40) || "anonymous";
      if (body.website) return { ok: true, skipWrite: true }; // honeypot
      if (!name) return { error: "Idea needs a name", status: 400 };
      if (state.ideas.filter((i) => i.status === "pending").length >= 100) {
        return { error: "Idea queue is full", status: 429 };
      }
      state.ideas.unshift({
        id: newId("idea"),
        name,
        note,
        by,
        suggestedDay: clean(body.suggestedDay, 10) || null,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      break;
    }

    case "approveIdea": {
      const err = adminOnly();
      if (err) return err;
      const idea = state.ideas.find((i) => i.id === body.id);
      if (!idea) return { error: "Not found", status: 404 };
      idea.status = "approved";
      idea.decidedAt = new Date().toISOString();
      if (body.date) {
        // Approve straight onto a day.
        const day = state.days.find((d) => d.date === body.date);
        if (!day) return { error: "Not found", status: 404 };
        idea.approvedDay = day.date;
        day.items.push({
          id: newId("i"),
          name: idea.name,
          note: idea.note,
          mapUrl: null,
          photos: [],
          source: "idea",
          suggestedBy: idea.by,
          approvedAt: idea.decidedAt,
        });
      } else {
        // Approved but unscheduled — Claude's sync routine slots it into a remaining day.
        idea.approvedDay = null;
      }
      break;
    }

    // Admin: place an approved-but-unscheduled idea onto a day.
    case "scheduleIdea": {
      const err = adminOnly();
      if (err) return err;
      const idea = state.ideas.find(
        (i) => i.id === body.id && i.status === "approved" && !i.approvedDay
      );
      const day = state.days.find((d) => d.date === body.date);
      if (!idea || !day) return { error: "Not found", status: 404 };
      idea.approvedDay = day.date;
      day.items.push({
        id: newId("i"),
        name: idea.name,
        note: idea.note,
        mapUrl: null,
        photos: [],
        source: "idea",
        suggestedBy: idea.by,
        approvedAt: new Date().toISOString(),
      });
      break;
    }

    case "rejectIdea": {
      const err = adminOnly();
      if (err) return err;
      const idea = state.ideas.find((i) => i.id === body.id);
      if (!idea) return { error: "Not found", status: 404 };
      idea.status = "rejected";
      idea.decidedAt = new Date().toISOString();
      break;
    }

    case "addItem": {
      const err = adminOnly();
      if (err) return err;
      const day = state.days.find((d) => d.date === body.date);
      const name = clean(body.name, 120);
      if (!day || !name) return { error: "Bad request", status: 400 };
      day.items.push({
        id: newId("i"),
        name,
        note: clean(body.note, 600),
        mapUrl: clean(body.mapUrl, 300) || null,
        photos: [],
        source: "admin",
        approvedAt: new Date().toISOString(),
      });
      break;
    }

    case "deleteItem": {
      const err = adminOnly();
      if (err) return err;
      const day = state.days.find((d) => d.date === body.date);
      if (!day) return { error: "Not found", status: 404 };
      const item = day.items.find((i) => i.id === body.id);
      day.items = day.items.filter((i) => i.id !== body.id);
      // best-effort: remove that item's photos from blob storage
      if (item) await Promise.all((item.photos || []).map((p) => deleteBlobUrl(p.url)));
      break;
    }

    case "deletePhoto": {
      const err = adminOnly();
      if (err) return err;
      // Remove by URL wherever it lives — item photos or general trip photos.
      const url = body.url;
      state.generalPhotos = (state.generalPhotos || []).filter((p) => p.url !== url);
      for (const day of state.days) {
        for (const item of [...day.items, ...(day.fixed || [])]) {
          item.photos = (item.photos || []).filter((p) => p.url !== url);
        }
      }
      await deleteBlobUrl(url);
      break;
    }

    // Crew or admin: move an existing photo to a different activity (or to general).
    // Fallback for when GPS auto-matching misses.
    case "movePhoto": {
      if (!["crew", "admin"].includes(role)) {
        return { error: "Crew PIN needed", status: 403 };
      }
      const url = body.url;
      const to = body.toItemId || "general";
      let photo = null;
      // pull it out of wherever it currently lives
      const gp = state.generalPhotos || [];
      const gi = gp.findIndex((p) => p.url === url);
      if (gi >= 0) {
        photo = gp[gi];
        gp.splice(gi, 1);
        state.generalPhotos = gp;
      }
      if (!photo) {
        for (const day of state.days) {
          for (const item of [...day.items, ...(day.fixed || [])]) {
            const idx = (item.photos || []).findIndex((p) => p.url === url);
            if (idx >= 0) {
              photo = item.photos[idx];
              item.photos.splice(idx, 1);
              break;
            }
          }
          if (photo) break;
        }
      }
      if (!photo) return { error: "Photo not found", status: 404 };
      // drop it into the destination
      if (to === "general") {
        state.generalPhotos = state.generalPhotos || [];
        state.generalPhotos.push(photo);
      } else {
        const found = findItem(state, to);
        if (!found) return { error: "Target not found", status: 404 };
        found.item.photos = found.item.photos || [];
        found.item.photos.push(photo);
      }
      break;
    }

    // Admin: edit an item's name / note / map link (works on flexible and fixed items).
    case "editItem": {
      const err = adminOnly();
      if (err) return err;
      let obj = null;
      for (const day of state.days) {
        obj = day.items.find((i) => i.id === body.id) || day.fixed.find((f) => f.id === body.id);
        if (obj) break;
      }
      if (!obj) return { error: "Not found", status: 404 };
      if (body.name !== undefined) {
        const name = clean(body.name, 120);
        if (!name) return { error: "Name can't be empty", status: 400 };
        obj.name = name;
      }
      if (body.note !== undefined) obj.note = clean(body.note, 600);
      if (body.mapUrl !== undefined) obj.mapUrl = clean(body.mapUrl, 300) || null;
      break;
    }

    // Crew or admin: check items off as done (works on flexible and fixed items).
    case "toggleDone": {
      if (!["crew", "admin"].includes(role)) {
        return { error: "Crew PIN needed", status: 403 };
      }
      let obj = null;
      for (const day of state.days) {
        obj = day.items.find((i) => i.id === body.id) || day.fixed.find((f) => f.id === body.id);
        if (obj) break;
      }
      if (!obj) return { error: "Not found", status: 404 };
      obj.done = obj.done
        ? null
        : { by: clean(body.by, 40) || "someone", at: new Date().toISOString() };
      break;
    }

    default:
      return { error: "Unknown action", status: 400 };
  }

  return { ok: true };
}
