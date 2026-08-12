import { NextResponse } from "next/server";
import { loadModelState } from "@/lib/model-state";
import { getActiveSportOptions, hasOddsApiKey } from "@/lib/odds";
import { getOddsQuota } from "@/lib/odds-quota";
import { oddsScheduleSummary } from "@/lib/odds-schedule";
import { getInSeasonSports } from "@/lib/sports-season";
import { hasWeatherUndergroundKey } from "@/lib/weather";

export async function GET() {
  const [model, oddsQuota] = await Promise.all([loadModelState(), getOddsQuota()]);
  const schedule = oddsScheduleSummary();
  return NextResponse.json({
    sports: getActiveSportOptions(),
    inSeason: getInSeasonSports().map((s) => s.label),
    oddsApiConfigured: hasOddsApiKey(),
    oddsQuota,
    oddsSchedule: schedule,
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
    note: "Upcoming-only boards. Odds API pulls at most once per endpoint per hour from 10am–9pm local (12×/day); out-of-season leagues stay off until 1 week before start.",
  });
}
