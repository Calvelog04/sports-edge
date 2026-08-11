import { NextResponse } from "next/server";
import { loadSavantLeague } from "@/lib/savant";

export const dynamic = "force-dynamic";

export async function GET() {
  const league = await loadSavantLeague();
  if (!league) {
    return NextResponse.json({ error: "Savant league unavailable" }, { status: 502 });
  }
  return NextResponse.json({
    fetchedAt: league.fetchedAt,
    season: league.season,
    source: league.source,
    teams: league.hitting.length,
    sample: league.hitting.slice(0, 5).map((t) => ({
      team: t.teamName,
      abbrev: t.teamAbbrev,
      xwoba: t.xwoba,
      barrelPct: t.barrelPct,
      hardHitPct: t.hardHitPct,
    })),
  });
}
