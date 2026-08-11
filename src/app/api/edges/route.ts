import { NextRequest, NextResponse } from "next/server";
import { buildEdges } from "@/lib/pipeline";
import { DEFAULT_SPORT, isProSport } from "@/lib/odds";
import { parseTiming } from "@/lib/timing";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sportParam = req.nextUrl.searchParams.get("sport") ?? DEFAULT_SPORT;
  const sport = isProSport(sportParam) ? sportParam : DEFAULT_SPORT;
  const timing = parseTiming(req.nextUrl.searchParams.get("timing"));

  try {
    const data = await buildEdges(sport, timing);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
