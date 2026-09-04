// iCloud Shared Album feed reader — new CloudKit-based share links
// (photos.icloud.com/shared/album/<key>), used by Photos in 2026.
// Flow: public/records/resolve (anon token + partition + zone) →
//       shared/records/changes (paginated CPLAsset/CPLMaster records).
// Album key comes from the public album URL; override with ICLOUD_ALBUM_TOKEN env.

const DEFAULT_KEY = "0998oFgfa0kAqH0AbqLGonPvg";
export const albumKey = () => process.env.ICLOUD_ALBUM_TOKEN || DEFAULT_KEY;

const CK = "https://ckdatabasews.icloud.com";
const DB = "database/1/com.apple.photos.cloud/production";
const CLIENT = "clientBuildNumber=2630BuildBeta18&clientMasteringNumber=2630BuildBeta18";

// Best-effort caches (serverless instances persist for a while).
let resolveCache = { at: 0, data: null };
let photoCache = { at: 0, photos: null };
const RESOLVE_TTL_MS = 10 * 60 * 1000; // anon token TTL is 20 min
const PHOTO_TTL_MS = 2 * 60 * 1000;

async function ckPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`iCloud request failed (${res.status})`);
  return res.json();
}

async function resolveShare() {
  if (resolveCache.data && Date.now() - resolveCache.at < RESOLVE_TTL_MS) {
    return resolveCache.data;
  }
  const key = albumKey();
  const j = await ckPost(
    `${CK}/${DB}/public/records/resolve?remapEnums=true&sharing_url_key=${key}&${CLIENT}`,
    { shortGUIDs: [{ value: key }] }
  );
  const r = (j.results || [])[0];
  if (!r || !r.anonymousPublicAccess) throw new Error("Album share could not be resolved");
  const data = {
    key,
    token: r.anonymousPublicAccess.token,
    partition: r.anonymousPublicAccess.databasePartition,
    zoneID: r.zoneID,
    ownerIdentity: r.ownerIdentity || null,
  };
  resolveCache = { at: Date.now(), data };
  return data;
}

const b64 = (s) => {
  try {
    return Buffer.from(s, "base64").toString("utf8");
  } catch {
    return "";
  }
};

const fieldVal = (rec, name) => rec?.fields?.[name]?.value;

// Extract a display name for a userRecordName from share participants / owner.
function nameMap(records, ownerIdentity) {
  const map = {};
  const add = (userRecordName, identity) => {
    if (!userRecordName || !identity) return;
    const nc = identity.nameComponents || {};
    const name = nc.givenName || [nc.givenName, nc.familyName].filter(Boolean).join(" ");
    if (name) map[userRecordName] = name;
  };
  if (ownerIdentity) add(ownerIdentity.userRecordName, ownerIdentity);
  for (const rec of records) {
    if (rec.recordType !== "cloudkit.share") continue;
    for (const p of rec.participants || rec.fields?.participants?.value || []) {
      const ident = p.userIdentity || p;
      add(ident?.userRecordName, ident);
    }
  }
  return map;
}

// Resolve one CPLMaster resource field to a signed, usable URL.
function resourceUrl(master, field) {
  const v = fieldVal(master, field);
  if (!v || !v.downloadURL) return null;
  let url = v.downloadURL;
  if (url.includes("${f}")) {
    const fn = b64(fieldVal(master, "filenameEnc") || "") || "photo.jpg";
    url = url.replace("${f}", encodeURIComponent(fn));
  }
  return { url, size: v.size || 0 };
}

function firstResource(master, fields) {
  for (const f of fields) {
    const r = resourceUrl(master, f);
    if (r) return r;
  }
  return null;
}

// Full-size derivative - the lightbox and the page background.
const FULL_PREFS = ["resJPEGMedRes", "resJPEGFullRes", "resOriginalRes", "resJPEGThumbRes", "resSidecarRes"];
// Small derivative - grid thumbnails. Apple's thumb res is a couple hundred
// pixels on the long edge, which is plenty for 84-190px tiles and a fraction
// of the bytes of the medium-res copy we were serving to every cell.
const THUMB_PREFS = ["resJPEGThumbRes", "resJPEGMedRes", "resJPEGFullRes", "resOriginalRes"];

// Pick usable image URLs from a CPLMaster record's resource fields.
// Falls back to the full-size URL when no thumb derivative exists, so
// callers can always rely on both fields being present.
function masterUrl(master) {
  const full = firstResource(master, FULL_PREFS);
  if (!full) return null;
  const thumb = firstResource(master, THUMB_PREFS);
  return { url: full.url, size: full.size, thumb: (thumb || full).url };
}

const tokyoDate = (ms) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(ms));

// Adding the same photo to a shared album twice (two upload batches) leaves
// two CPLAsset records pointing at one master, and we rendered both - the
// album looks clean in Photos, which collapses them, while the site showed
// every copy. Collapse on the master's content fingerprint so one image is
// one photo. The earliest-added asset wins so guids stay stable, and the
// guids we drop ride along in dupeGuids so item assignments made against a
// dropped copy still resolve.
function dedupeByImage(photos) {
  const firstFor = new Map();
  const kept = [];
  for (const p of photos) {
    const key = p.fingerprint || p.masterRef || p.guid;
    const prev = firstFor.get(key);
    if (!prev) {
      p.dupeGuids = [];
      firstFor.set(key, p);
      kept.push(p);
      continue;
    }
    if (p.addedAt && prev.addedAt && p.addedAt < prev.addedAt) {
      p.dupeGuids = prev.dupeGuids.concat(prev.guid);
      kept[kept.indexOf(prev)] = p;
      firstFor.set(key, p);
    } else {
      prev.dupeGuids.push(p.guid);
    }
  }
  return kept;
}

// Returns [{guid, caption, by, takenAt, day, url, isVideo}] — url is signed & short-lived.
export async function fetchAlbumPhotos({ withUrls = true } = {}) {
  if (photoCache.photos && Date.now() - photoCache.at < PHOTO_TTL_MS) return photoCache.photos;
  const share = await resolveShare();
  const url = `${share.partition}/${DB}/shared/records/changes?remapEnums=true&sharing_url_key=${share.key}&publicAccessAuthToken=${encodeURIComponent(share.token)}&${CLIENT}`;
  let records = [];
  let syncToken = null;
  for (let i = 0; i < 25; i++) {
    const body = syncToken ? { zoneID: share.zoneID, syncToken } : { zoneID: share.zoneID };
    const q = await ckPost(url, body);
    records.push(...(q.records || []));
    syncToken = q.syncToken;
    if (!q.moreComing) break;
  }

  const names = nameMap(records, share.ownerIdentity);
  const masters = {};
  for (const rec of records) {
    if (rec.recordType === "CPLMaster" && !rec.deleted) masters[rec.recordName] = rec;
  }

  const photos = [];
  for (const rec of records) {
    if (rec.recordType !== "CPLAsset" || rec.deleted) continue;
    if (fieldVal(rec, "isDeleted") === 1 || fieldVal(rec, "isHidden") === 1) continue;
    // Removing a photo from a shared album marks it expunged rather than
    // isDeleted, so checking isDeleted alone leaves deleted photos on the site.
    if (fieldVal(rec, "isExpunged") === 1 || fieldVal(rec, "dateExpunged")) continue;
    if (fieldVal(rec, "trashReason")) continue;
    const masterRef = fieldVal(rec, "masterRef")?.recordName;
    const master = masterRef ? masters[masterRef] : null;
    const takenMs =
      fieldVal(rec, "assetDate") ||
      (master && fieldVal(master, "originalCreationDate")) ||
      rec.created?.timestamp ||
      null;
    const itemType = (master && b64(fieldVal(master, "itemTypeEnc") || "")) ||
      (master && fieldVal(master, "itemType")) || "";
    const isVideo =
      /video|movie|mpeg|quicktime/i.test(String(itemType)) ||
      !!(master && fieldVal(master, "resVidFullRes"));
    const resolved = withUrls && master ? masterUrl(master) : null;
    if (withUrls && !resolved) continue; // nothing displayable
    photos.push({
      guid: rec.recordName,
      caption: b64(fieldVal(rec, "captionEnc") || "").trim(),
      by:
        names[rec.created?.userRecordName] ||
        (share.ownerIdentity?.nameComponents?.givenName ?? "someone"),
      takenAt: takenMs ? new Date(takenMs).toISOString() : null,
      day: takenMs ? tokyoDate(takenMs) : null,
      url: resolved ? resolved.url : null,
      thumb: resolved ? resolved.thumb : null,
      isVideo,
      // Kept for de-duplication below, not for display.
      masterRef: masterRef || null,
      fingerprint: (master && fieldVal(master, "resOriginalFingerprint")) || null,
      addedAt: Number(fieldVal(rec, "addedDate") || 0) || null,
    });
  }
  const out = dedupeByImage(photos.filter((p) => !p.isVideo));
  out.sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1));
  photoCache = { at: Date.now(), photos: out };
  return out;
}

// Debug helper: raw record type counts + field keys (no values) for remote inspection.
export async function albumDebug() {
  const share = await resolveShare();
  const url = `${share.partition}/${DB}/shared/records/changes?remapEnums=true&sharing_url_key=${share.key}&publicAccessAuthToken=${encodeURIComponent(share.token)}&${CLIENT}`;
  let records = [];
  let syncToken = null;
  for (let i = 0; i < 25; i++) {
    const body = syncToken ? { zoneID: share.zoneID, syncToken } : { zoneID: share.zoneID };
    const q = await ckPost(url, body);
    records.push(...(q.records || []));
    syncToken = q.syncToken;
    if (!q.moreComing) break;
  }
  const byType = {};
  for (const r of records) {
    byType[r.recordType] = byType[r.recordType] || { count: 0, fieldKeys: new Set() };
    byType[r.recordType].count++;
    for (const k of Object.keys(r.fields || {})) byType[r.recordType].fieldKeys.add(k);
  }
  return Object.fromEntries(
    Object.entries(byType).map(([t, v]) => [t, { count: v.count, fields: [...v.fieldKeys] }])
  );
}
