import { NextRequest, NextResponse } from "next/server";
import { buildBestPicks } from "@/lib/best-picks";
import { DEFAULT_SPORT, isProSport } from "@/lib/odds";
import { parseTiming } from "@/lib/timing";
import type { SportKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sportParam = req.nextUrl.searchParams.get("sport") ?? "all";
  const sport: SportKey | "all" =
    sportParam === "all" ? "all" : isProSport(sportParam) ? sportParam : DEFAULT_SPORT;
  const timing = parseTiming(req.nextUrl.searchParams.get("timing"));

  try {
    const data = await buildBestPicks(sport, timing);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Best picks failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
