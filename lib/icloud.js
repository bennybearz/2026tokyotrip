// iCloud Shared Album (public website) feed reader.
// Uses the long-standing unofficial sharedstreams API behind icloud.com/sharedalbum.
// Album token comes from the public album URL; override with ICLOUD_ALBUM_TOKEN env.

const DEFAULT_TOKEN = "0998oFgfa0kAqH0AbqLGonPvg";
export const albumToken = () => process.env.ICLOUD_ALBUM_TOKEN || DEFAULT_TOKEN;

// Module-level cache (best-effort on serverless; instances are reused for a while).
let cache = { at: 0, host: null, photos: null };
const STREAM_TTL_MS = 3 * 60 * 1000;

async function post(host, token, path, body) {
  const res = await fetch(`https://${host}/${token}/sharedstreams/${path}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return res;
}

async function resolveHost(token) {
  if (cache.host) return cache.host;
  let host = "p01-sharedstreams.icloud.com";
  const res = await post(host, token, "webstream", { streamCtag: null });
  if (res.status === 330) {
    const j = await res.json().catch(() => ({}));
    if (j["X-Apple-MMe-Host"]) host = j["X-Apple-MMe-Host"];
  }
  cache.host = host;
  return host;
}

const tokyoDate = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(iso));

// Returns [{guid, caption, by, takenAt, day, width, height, checksum, isVideo}]
export async function fetchAlbumPhotos() {
  const token = albumToken();
  if (!token) return [];
  if (cache.photos && Date.now() - cache.at < STREAM_TTL_MS) return cache.photos;
  const host = await resolveHost(token);
  let res = await post(host, token, "webstream", { streamCtag: null });
  if (res.status === 330) {
    const j = await res.json().catch(() => ({}));
    if (j["X-Apple-MMe-Host"]) {
      cache.host = j["X-Apple-MMe-Host"];
      res = await post(cache.host, token, "webstream", { streamCtag: null });
    }
  }
  if (!res.ok) throw new Error(`Album feed failed (${res.status})`);
  const data = await res.json();
  const photos = (data.photos || [])
    .filter((p) => p && p.photoGuid)
    .map((p) => {
      // pick the largest derivative for display; keep its checksum for URL resolution
      const derivs = Object.entries(p.derivatives || {})
        .map(([k, v]) => ({ key: k, ...v }))
        .sort((a, b) => Number(b.width || 0) - Number(a.width || 0));
      const best = derivs[0] || {};
      const takenAt = p.dateCreated || p.batchDateCreated || null;
      return {
        guid: p.photoGuid,
        caption: (p.caption || "").trim(),
        by: p.contributorFirstName || p.contributorFullName || "someone",
        takenAt,
        day: takenAt ? tokyoDate(takenAt) : null,
        width: Number(best.width || 0),
        height: Number(best.height || 0),
        checksum: best.checksum || null,
        isVideo: (p.mediaAssetType || "").toLowerCase() === "video",
      };
    })
    .filter((p) => !p.isVideo && p.checksum);
  cache = { ...cache, at: Date.now(), photos };
  return photos;
}

// Resolve display URLs for a set of checksums. URLs are signed and expire, so
// call per-request and do not persist them.
export async function resolveAssetUrls(guids) {
  const token = albumToken();
  const host = await resolveHost(token);
  const res = await post(host, token, "webasseturls", { photoGuids: guids });
  if (!res.ok) throw new Error(`Asset URL fetch failed (${res.status})`);
  const data = await res.json();
  const byChecksum = {};
  for (const [checksum, loc] of Object.entries(data.items || {})) {
    if (loc && loc.url_location && loc.url_path) {
      byChecksum[checksum] = `https://${loc.url_location}${loc.url_path}`;
    }
  }
  return byChecksum;
}
