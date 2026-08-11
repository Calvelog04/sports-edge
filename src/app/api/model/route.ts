import { NextResponse } from "next/server";
import { learnFromSettledPicks } from "@/lib/learn";
import { loadModelState } from "@/lib/model-state";
import { readPicks } from "@/lib/picks";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await loadModelState();
  return NextResponse.json({ state });
}

/** Force a retrain from all graded picks. */
export async function POST() {
  const picks = await readPicks();
  const result = await learnFromSettledPicks(picks);
  return NextResponse.json({
    learned: result.learned,
    ran: true,
    state: result.state,
  });
}
