import { buildEdges } from "@/lib/pipeline";
import { DEFAULT_SPORT, SPORT_OPTIONS, isProSport } from "@/lib/odds";
import { parseTiming, type GameTiming } from "@/lib/timing";
import type { EdgeOpportunity, OddsQuotaInfo, SportKey } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface CalendarResponse {
  generatedAt: string;
  mode: "live" | "unavailable";
  timing: GameTiming;
  opportunities: EdgeOpportunity[];
  warnings: string[];
  sports: SportKey[];
  oddsQuota?: OddsQuotaInfo;
}

export async function GET(req: NextRequest) {
  const sportParam = req.nextUrl.searchParams.get("sport");
  const timing = parseTiming(req.nextUrl.searchParams.get("timing"));
  const sports: SportKey[] =
    sportParam && sportParam !== "all"
      ? isProSport(sportParam)
        ? [sportParam]
        : [DEFAULT_SPORT]
      : SPORT_OPTIONS.map((s) => s.key);

  try {
    const results = await Promise.all(sports.map((s) => buildEdges(s, timing)));
    const opportunities = results
      .flatMap((r) => r.opportunities)
      .sort((a, b) => b.bestEdge - a.bestEdge);

    const anyLive = results.some((r) => r.mode === "live");
    const warnings = [...new Set(results.flatMap((r) => r.warnings))];

    const payload: CalendarResponse = {
      generatedAt: new Date().toISOString(),
      mode: anyLive ? "live" : "unavailable",
      timing,
      opportunities,
      warnings,
      sports,
      oddsQuota: results.find((r) => r.oddsQuota)?.oddsQuota,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
