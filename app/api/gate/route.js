import { NextResponse } from "next/server";
import {
  gateWordOk,
  gateCookieValue,
  GATE_COOKIE_NAME,
  roleForPin,
  cookieValue,
  COOKIE_NAME,
} from "../../../lib/auth";

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 90,
  path: "/",
};

// Accepts either a viewing passphrase OR a crew/admin PIN.
export async function POST(req) {
  const { pass } = await req.json().catch(() => ({}));
  const value = (pass || "").trim();

  const role = roleForPin(value);
  if (role) {
    const res = NextResponse.json({ access: true, role });
    res.cookies.set(COOKIE_NAME, cookieValue(role), cookieOpts);
    res.cookies.set(GATE_COOKIE_NAME, gateCookieValue(), cookieOpts);
    return res;
  }

  if (gateWordOk(value)) {
    const res = NextResponse.json({ access: true, role: "viewer" });
    res.cookies.set(GATE_COOKIE_NAME, gateCookieValue(), cookieOpts);
    return res;
  }

  return NextResponse.json({ error: "That's not it." }, { status: 401 });
}
