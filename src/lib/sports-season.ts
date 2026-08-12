import type { SportKey } from "./types";

/** Calendar month/day in local season sense (no timezone). */
type Md = { month: number; day: number };

export interface SportSeasonWindow {
  key: SportKey;
  label: string;
  /** Regular-season / primary slate start (sport turns on 7 days before this). */
  seasonStart: Md;
  /** Inclusive end of when we keep the sport available. */
  seasonEnd: Md;
}

/**
 * Approximate US major-league calendars.
 * Sport is enabled from (seasonStart − 7 days) through seasonEnd.
 */
export const SPORT_SEASONS: SportSeasonWindow[] = [
  {
    key: "baseball_mlb",
    label: "MLB",
    seasonStart: { month: 3, day: 27 },
    seasonEnd: { month: 11, day: 5 },
  },
  {
    key: "americanfootball_nfl",
    label: "NFL",
    seasonStart: { month: 9, day: 4 },
    seasonEnd: { month: 2, day: 15 },
  },
  {
    key: "americanfootball_ncaaf",
    label: "NCAAF",
    seasonStart: { month: 8, day: 24 },
    seasonEnd: { month: 1, day: 20 },
  },
  {
    key: "basketball_nba",
    label: "NBA",
    seasonStart: { month: 10, day: 21 },
    seasonEnd: { month: 6, day: 22 },
  },
  {
    key: "basketball_ncaab",
    label: "NCAAB",
    seasonStart: { month: 11, day: 4 },
    seasonEnd: { month: 4, day: 8 },
  },
  {
    key: "icehockey_nhl",
    label: "NHL",
    seasonStart: { month: 10, day: 7 },
    seasonEnd: { month: 6, day: 18 },
  },
];

const PRESEASON_DAYS = 7;

function mdToOrdinal(month: number, day: number): number {
  return month * 100 + day;
}

function dateToOrdinal(d: Date): number {
  return mdToOrdinal(d.getMonth() + 1, d.getDate());
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + days);
  return x;
}

function windowIncludes(ord: number, start: Md, end: Md): boolean {
  const s = mdToOrdinal(start.month, start.day);
  const e = mdToOrdinal(end.month, end.day);
  if (s <= e) {
    return ord >= s && ord <= e;
  }
  // Wraps year (e.g. NFL Sep → Feb)
  return ord >= s || ord <= e;
}

/** True from 1 week before seasonStart through seasonEnd. */
export function isSportInSeason(sport: SportKey, now = new Date()): boolean {
  const cfg = SPORT_SEASONS.find((s) => s.key === sport);
  if (!cfg) return false;

  const openDate = addDays(
    new Date(now.getFullYear(), cfg.seasonStart.month - 1, cfg.seasonStart.day),
    -PRESEASON_DAYS,
  );
  // If openDate fell into previous year visually, still compare via ordinals with wrap
  const openMd: Md = { month: openDate.getMonth() + 1, day: openDate.getDate() };
  return windowIncludes(dateToOrdinal(now), openMd, cfg.seasonEnd);
}

export function getInSeasonSports(now = new Date()): SportSeasonWindow[] {
  return SPORT_SEASONS.filter((s) => isSportInSeason(s.key, now));
}

export function getInSeasonSportOptions(
  now = new Date(),
): Array<{ key: SportKey; label: string }> {
  return getInSeasonSports(now).map((s) => ({ key: s.key, label: s.label }));
}

export function defaultInSeasonSport(now = new Date()): SportKey {
  const active = getInSeasonSportOptions(now);
  return active[0]?.key ?? "baseball_mlb";
}

export function assertSportInSeason(sport: string, now = new Date()): sport is SportKey {
  return SPORT_SEASONS.some((s) => s.key === sport) && isSportInSeason(sport as SportKey, now);
}
