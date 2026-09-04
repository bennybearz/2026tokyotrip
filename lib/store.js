import { list, put, del } from "@vercel/blob";
import { SEED } from "../data/seed";

const PREFIX = "state/state-";
const ALBUM_PREFIX = "album/cache-";
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

// In-memory fallback for local dev without a Blob store (non-persistent).
function mem() {
  if (!globalThis.__wtState) {
    globalThis.__wtState = JSON.parse(JSON.stringify(SEED));
  }
  return globalThis.__wtState;
}

async function latestBlob() {
  const { blobs } = await list({ prefix: PREFIX });
  if (!blobs.length) return null;
  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
  return blobs;
}

export async function readState() {
  if (!hasBlob()) return mem();
  const blobs = await latestBlob();
  if (!blobs) {
    const state = JSON.parse(JSON.stringify(SEED));
    await writeState(state);
    return state;
  }
  const res = await fetch(blobs[0].url, { cache: "no-store" });
  return await res.json();
}

export async function writeState(state) {
  state.updatedAt = new Date().toISOString();
  if (!hasBlob()) {
    globalThis.__wtState = state;
    return;
  }
  // Versioned writes (unique paths) avoid CDN staleness on overwrite.
  const ts = String(Date.now()).padStart(15, "0");
  await put(`${PREFIX}${ts}.json`, JSON.stringify(state), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  // Prune old versions, keep the 5 newest.
  try {
    const blobs = await latestBlob();
    if (blobs && blobs.length > 5) {
      await Promise.all(blobs.slice(5).map((b) => del(b.url)));
    }
  } catch {
    // pruning is best-effort
  }
}

// ---- iCloud album record cache -------------------------------------------
// The album feed is paginated and slow to walk end to end, so the record set
// and its syncToken live here between requests. Lambdas don't share memory,
// so this has to be durable, not module state.

async function latestAlbumBlob() {
  const { blobs } = await list({ prefix: ALBUM_PREFIX });
  if (!blobs.length) return null;
  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
  return blobs;
}

export async function readAlbumCache() {
  if (!hasBlob()) return globalThis.__wtAlbum || null;
  try {
    const blobs = await latestAlbumBlob();
    if (!blobs) return null;
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    return await res.json();
  } catch {
    return null; // a cold walk is always a valid fallback
  }
}

export async function writeAlbumCache(cache) {
  if (!hasBlob()) {
    globalThis.__wtAlbum = cache;
    return;
  }
  try {
    const ts = String(Date.now()).padStart(15, "0");
    await put(`${ALBUM_PREFIX}${ts}.json`, JSON.stringify(cache), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    const blobs = await latestAlbumBlob();
    if (blobs && blobs.length > 3) {
      await Promise.all(blobs.slice(3).map((b) => del(b.url)));
    }
  } catch {
    // caching is best-effort; a failed write just means a slower next request
  }
}

export async function deleteBlobUrl(url) {
  if (!hasBlob()) return;
  try {
    await del(url);
  } catch {
    // best-effort
  }
}

export function findItem(state, itemId) {
  for (const day of state.days) {
    const item =
      day.items.find((i) => i.id === itemId) ||
      (day.fixed || []).find((f) => f.id === itemId);
    if (item) return { day, item };
  }
  return null;
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
