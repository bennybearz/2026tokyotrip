import { NextResponse } from "next/server";
import {
  roleForPin,
  cookieValue,
  COOKIE_NAME,
  gateCookieValue,
  GATE_COOKIE_NAME,
} from "../../../lib/auth";

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 90,
  path: "/",
};

export async function POST(req) {
  const { pin } = await req.json().catch(() => ({}));
  const role = roleForPin((pin || "").trim());
  if (!role) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  const res = NextResponse.json({ role });
  res.cookies.set(COOKIE_NAME, cookieValue(role), cookieOpts);
  res.cookies.set(GATE_COOKIE_NAME, gateCookieValue(), cookieOpts);
  return res;
}

// Full logout — clears role AND gate, sending the visitor back to the passphrase screen.
export async function DELETE() {
  const res = NextResponse.json({ role: "viewer", access: false });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  res.cookies.set(GATE_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
