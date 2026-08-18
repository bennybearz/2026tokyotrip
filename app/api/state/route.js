import { NextResponse } from "next/server";
import { readState } from "../../../lib/store";
import { currentRole, hasGateAccess } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const [role, access] = await Promise.all([currentRole(), hasGateAccess()]);
  if (!access) return NextResponse.json({ role, access: false, state: null });
  const state = await readState();
  return NextResponse.json({ role, access: true, state });
}
