import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE = "wt_role";
const GATE_COOKIE = "wt_gate";

// Passphrases that unlock viewing (case-insensitive). Override with GATE_WORDS env (comma-separated).
const GATE_WORDS = (process.env.GATE_WORDS || "holub,lukens,barry")
  .split(",")
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

function secret() {
  return (
    process.env.AUTH_SECRET ||
    crypto
      .createHash("sha256")
      .update(`${process.env.TRIP_PIN || "trip"}|${process.env.ADMIN_PIN || "admin"}`)
      .digest("hex")
  );
}

function sign(role) {
  const mac = crypto.createHmac("sha256", secret()).update(role).digest("hex");
  return `${role}.${mac}`;
}

export function roleForPin(pin) {
  if (!pin) return null;
  if (process.env.ADMIN_PIN && pin === process.env.ADMIN_PIN) return "admin";
  if (process.env.TRIP_PIN && pin === process.env.TRIP_PIN) return "crew";
  return null;
}

export function cookieValue(role) {
  return sign(role);
}

export function gateWordOk(word) {
  return !!word && GATE_WORDS.includes(String(word).trim().toLowerCase());
}

export function gateCookieValue() {
  return sign("gate");
}

export const COOKIE_NAME = COOKIE;
export const GATE_COOKIE_NAME = GATE_COOKIE;

// True once a valid passphrase has been entered (crew/admin roles also count as access).
export async function hasGateAccess() {
  const jar = await cookies();
  const raw = jar.get(GATE_COOKIE)?.value;
  if (raw) {
    const expected = sign("gate");
    const a = Buffer.from(raw);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return (await currentRole()) !== "viewer";
}

// Returns "admin" | "crew" | "viewer"
export async function currentRole() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return "viewer";
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return "viewer";
  const role = raw.slice(0, idx);
  if (!["admin", "crew"].includes(role)) return "viewer";
  const expected = sign(role);
  const a = Buffer.from(raw);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "viewer";
  return role;
}
