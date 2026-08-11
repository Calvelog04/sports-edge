import { NextResponse } from "next/server";
import { settleOpenPicks } from "@/lib/picks";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await settleOpenPicks();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Settle failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
