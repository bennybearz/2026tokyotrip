import { NextResponse } from "next/server";
import { readState, writeState } from "../../../lib/store";
import { currentRole } from "../../../lib/auth";
import { applyAction } from "../../../lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const role = await currentRole();
  const body = await req.json().catch(() => ({}));
  const state = await readState();

  const result = await applyAction(state, body, role);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (!result.skipWrite) await writeState(state);
  return NextResponse.json({ ok: true, state, role });
}
