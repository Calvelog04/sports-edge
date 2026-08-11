import type { RestTravelContext, SportKey } from "./types";

const REST_SPORTS: SportKey[] = [
  "basketball_nba",
  "basketball_ncaab",
  "icehockey_nhl",
  "americanfootball_nfl",
  "americanfootball_ncaaf",
];

const ESPN_PATH: Partial<Record<SportKey, string>> = {
  basketball_nba: "basketball/nba",
  basketball_ncaab: "basketball/mens-college-basketball",
  icehockey_nhl: "hockey/nhl",
  americanfootball_nfl: "football/nfl",
  americanfootball_ncaaf: "football/college-football",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * Rough rest proxy from ESPN team schedule: days since last completed game.
 * Favors the fresher side slightly.
 */
export async function fetchRestTravel(opts: {
  sport: SportKey;
  homeTeamId?: string;
  awayTeamId?: string;
  commenceTime: string;
}): Promise<RestTravelContext | null> {
  if (!REST_SPORTS.includes(opts.sport)) return null;
  const path = ESPN_PATH[opts.sport];
  if (!path || !opts.homeTeamId || !opts.awayTeamId) return null;

  const kickoff = new Date(opts.commenceTime);
  if (Number.isNaN(kickoff.getTime())) return null;

  async function lastGameDays(teamId: string): Promise<number | null> {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/schedule`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": UA,
          Referer: "https://www.espn.com/",
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        events?: Array<{ date?: string; competitions?: Array<{ status?: { type?: { completed?: boolean } } }> }>;
      };
      const past = (data.events ?? [])
        .filter((e) => e.competitions?.[0]?.status?.type?.completed)
        .map((e) => new Date(String(e.date)))
        .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() < kickoff.getTime())
        .sort((a, b) => b.getTime() - a.getTime());
      if (!past[0]) return null;
      return daysBetween(kickoff, past[0]);
    } catch {
      return null;
    }
  }

  const [homeDaysRest, awayDaysRest] = await Promise.all([
    lastGameDays(opts.homeTeamId),
    lastGameDays(opts.awayTeamId),
  ]);

  if (homeDaysRest == null && awayDaysRest == null) return null;

  const h = homeDaysRest ?? 2;
  const a = awayDaysRest ?? 2;
  // B2B (0–1 day) is a penalty; 3+ days rest is mild boost
  const homeFresh = h <= 1 ? -0.04 : h >= 3 ? 0.02 : 0;
  const awayFresh = a <= 1 ? -0.04 : a >= 3 ? 0.02 : 0;
  const lean = Math.max(0.42, Math.min(0.58, 0.5 + homeFresh - awayFresh));

  return {
    homeDaysRest,
    awayDaysRest,
    homeWinLean: lean,
    note: `Rest: home ${homeDaysRest ?? "?"}d · away ${awayDaysRest ?? "?"}d`,
  };
}
