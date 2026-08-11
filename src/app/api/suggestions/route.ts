import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_SPORT, isProSport } from "@/lib/odds";
import { buildSuggestions } from "@/lib/suggestions";
import { parseTiming } from "@/lib/timing";
import type { SportKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sportParam = req.nextUrl.searchParams.get("sport") ?? "all";
  const sport: SportKey | "all" =
    sportParam === "all" ? "all" : isProSport(sportParam) ? sportParam : DEFAULT_SPORT;
  const timing = parseTiming(req.nextUrl.searchParams.get("timing"));

  try {
    const data = await buildSuggestions(sport, timing);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Suggestions failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
