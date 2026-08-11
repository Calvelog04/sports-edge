import type { SportKey } from "./types";

/** Live leagues only — no demo sports. */
export const SPORT_OPTIONS: Array<{ key: SportKey; label: string }> = [
  { key: "baseball_mlb", label: "MLB" },
  { key: "americanfootball_nfl", label: "NFL" },
  { key: "americanfootball_ncaaf", label: "NCAAF" },
  { key: "basketball_nba", label: "NBA" },
  { key: "basketball_ncaab", label: "NCAAB" },
  { key: "icehockey_nhl", label: "NHL" },
];

export const DEFAULT_SPORT: SportKey = "baseball_mlb";
