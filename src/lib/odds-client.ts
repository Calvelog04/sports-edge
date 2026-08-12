import type { SportKey } from "./types";
import { defaultInSeasonSport, getInSeasonSportOptions } from "./sports-season";

/** All known leagues (season filter applied via getActiveSportOptions). */
export const SPORT_OPTIONS: Array<{ key: SportKey; label: string }> = [
  { key: "baseball_mlb", label: "MLB" },
  { key: "americanfootball_nfl", label: "NFL" },
  { key: "americanfootball_ncaaf", label: "NCAAF" },
  { key: "basketball_nba", label: "NBA" },
  { key: "basketball_ncaab", label: "NCAAB" },
  { key: "icehockey_nhl", label: "NHL" },
];

/** Sports currently in season (or within 1 week of start). */
export function getActiveSportOptions(
  now = new Date(),
): Array<{ key: SportKey; label: string }> {
  const active = getInSeasonSportOptions(now);
  return active.length > 0 ? active : SPORT_OPTIONS.slice(0, 1);
}

export const DEFAULT_SPORT: SportKey = defaultInSeasonSport();
