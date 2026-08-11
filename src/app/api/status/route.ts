import { NextResponse } from "next/server";
import { loadModelState } from "@/lib/model-state";
import { SPORT_OPTIONS, hasOddsApiKey } from "@/lib/odds";
import { getOddsQuota } from "@/lib/odds-quota";
import { hasWeatherUndergroundKey } from "@/lib/weather";

export async function GET() {
  const [model, oddsQuota] = await Promise.all([loadModelState(), getOddsQuota()]);
  return NextResponse.json({
    sports: SPORT_OPTIONS,
    oddsApiConfigured: hasOddsApiKey(),
    oddsQuota,
    weatherUndergroundConfigured: hasWeatherUndergroundKey(),
    weather: hasWeatherUndergroundKey()
      ? "Weather Underground (api.weather.com) primary · Open-Meteo fallback"
      : "Open-Meteo fallback · set WU_API_KEY for Weather Underground",
    espn: "ESPN public APIs — scoreboard, injuries, team history, player season stats",
    baseballSavant:
      "MLB Baseball Savant league Statcast (xwOBA, barrels, hard-hit, staff quality) blended into MLB edges",
    mlbProps:
      "MLB props board: player to record a hit, player to record a HR, 1st-inning over/under via Odds API event markets",
    boxScores:
      "MLB Stats API box scores grade prop picks (batter hits/HRs + 1st-inning runs) when you Check results",
    learning: {
      samplesLearned: model.samplesLearned,
      lastLearnDate: model.lastLearnDate,
      convictionScale: model.convictionScale,
      edgeMinPct: model.edgeMinPct,
      teamsTracked: Object.keys(model.teamElo).length,
      weights: model.weights,
      dailyLog: model.dailyLog.slice(0, 7),
    },
    note: "Live leagues: MLB, NFL, NCAAF, NBA, NCAAB, NHL. Odds responses cached ~60s; Best/Suggested share one slate.",
  });
}
