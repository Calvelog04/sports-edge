import type { SportKey } from "./types";
import { GAME_DATE_TZ, gameDateKey } from "./pick-identity";

export interface ScoreEvent {
  id: string;
  sport_key: string;
  commence_time?: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
}

/** ESPN public scoreboard finals across nearby days (Elo sync / bulk). */
const ESPN_SCORE_PATH: Record<string, string> = {
  americanfootball_nfl: "football/nfl",
  basketball_nba: "basketball/nba",
  baseball_mlb: "baseball/mlb",
  icehockey_nhl: "hockey/nhl",
  americanfootball_ncaaf: "football/college-football",
  basketball_ncaab: "basketball/mens-college-basketball",
};

const ESPN_HEADERS: HeadersInit = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Referer: "https://www.espn.com/",
  Origin: "https://www.espn.com",
};

function localYmd(d: Date): string {
  return gameDateKey(d.toISOString(), GAME_DATE_TZ).replace(/-/g, "");
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreNamesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aTokens = new Set(na.split(" "));
  const overlap = nb.split(" ").filter((t) => aTokens.has(t) && t.length > 2).length;
  return overlap >= 2;
}

/** True when both kickoffs fall on the same app slate calendar day (CT). */
export function commenceTimesAlign(
  a?: string | null,
  b?: string | null,
): boolean {
  if (!a || !b) return false;
  const da = gameDateKey(a);
  const db = gameDateKey(b);
  return Boolean(da && db && da === db);
}

function teamsMatchEvent(
  event: ScoreEvent,
  homeTeam: string,
  awayTeam: string,
): boolean {
  return (
    scoreNamesMatch(event.home_team, homeTeam) &&
    scoreNamesMatch(event.away_team, awayTeam)
  );
}

/** ESPN scoreboard for one calendar day `YYYYMMDD` in the app slate timezone. */
export async function fetchEspnScoresForDate(
  sport: string,
  yyyymmdd: string,
): Promise<ScoreEvent[]> {
  const path = ESPN_SCORE_PATH[sport];
  if (!path || !/^\d{8}$/.test(yyyymmdd)) return [];

  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${yyyymmdd}`,
      { cache: "no-store", headers: ESPN_HEADERS },
    );
    if (!res.ok) return [];
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) return [];
    const data = JSON.parse(text) as { events?: Array<Record<string, unknown>> };
    const out: ScoreEvent[] = [];
    for (const ev of data.events ?? []) {
      const competition = (ev.competitions as Array<Record<string, unknown>> | undefined)?.[0];
      if (!competition) continue;
      const competitors = (competition.competitors as Array<Record<string, unknown>>) ?? [];
      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");
      const homeTeam = String(
        ((home?.team as Record<string, unknown> | undefined)?.displayName as string) ?? "",
      );
      const awayTeam = String(
        ((away?.team as Record<string, unknown> | undefined)?.displayName as string) ?? "",
      );
      if (!homeTeam || !awayTeam) continue;
      const status = ev.status as Record<string, unknown> | undefined;
      const statusType = status?.type as Record<string, unknown> | undefined;
      const completed = Boolean(statusType?.completed);
      const id = String(ev.id ?? "");
      if (!id) continue;
      const homeScore = home?.score != null ? String(home.score) : "";
      const awayScore = away?.score != null ? String(away.score) : "";
      const commence_time = String(ev.date ?? competition.date ?? "");
      out.push({
        id,
        sport_key: sport,
        commence_time,
        completed,
        home_team: homeTeam,
        away_team: awayTeam,
        scores:
          homeScore !== "" && awayScore !== ""
            ? [
                { name: homeTeam, score: homeScore },
                { name: awayTeam, score: awayScore },
              ]
            : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Resolve the ESPN game that matches this pick's listed kickoff date + teams.
 * Uses the bet's commenceTime calendar day (CT) → ESPN scoreboard for that date only.
 */
export async function fetchEspnScoreEventForPick(pick: {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}): Promise<ScoreEvent | null> {
  const day = gameDateKey(pick.commenceTime);
  if (!day) return null;
  const ymd = day.replace(/-/g, "");
  const events = await fetchEspnScoresForDate(pick.sport, ymd);
  const onDay = events.filter((e) => {
    if (!teamsMatchEvent(e, pick.homeTeam, pick.awayTeam)) return false;
    // Prefer ESPN rows whose own kickoff is the same CT day as the bet.
    if (e.commence_time && gameDateKey(e.commence_time) !== day) return false;
    return true;
  });
  if (onDay.length === 0) return null;
  if (onDay.length === 1) return onDay[0]!;

  const tip = Date.parse(pick.commenceTime);
  return [...onDay].sort((a, b) => {
    const da = Math.abs(Date.parse(String(a.commence_time ?? "")) - tip);
    const db = Math.abs(Date.parse(String(b.commence_time ?? "")) - tip);
    return da - db;
  })[0]!;
}

/** ESPN public scoreboard finals (no API key). */
export async function fetchEspnScoresForSport(
  sport: string,
  daysFrom = 3,
): Promise<ScoreEvent[]> {
  const path = ESPN_SCORE_PATH[sport];
  if (!path) return [];

  const byId = new Map<string, ScoreEvent>();
  const now = new Date();
  for (let offset = -daysFrom; offset <= 1; offset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    const dates = localYmd(day);
    const rows = await fetchEspnScoresForDate(sport, dates);
    for (const row of rows) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function fetchOddsApiScores(sport: string, daysFrom: number): Promise<ScoreEvent[]> {
  const { hasOddsApiKey, oddsApiFetch } = await import("./odds");
  if (!hasOddsApiKey()) return [];
  const res = await oddsApiFetch(
    (apiKey) =>
      `https://api.the-odds-api.com/v4/sports/${sport}/scores?apiKey=${encodeURIComponent(apiKey)}&daysFrom=${daysFrom}`,
  );
  if (!res.ok) return [];
  return (await res.json()) as ScoreEvent[];
}

function mergeScoreEvents(fromOdds: ScoreEvent[], fromEspn: ScoreEvent[]): ScoreEvent[] {
  if (fromOdds.length === 0) return fromEspn;
  if (fromEspn.length === 0) return fromOdds;

  const merged = new Map<string, ScoreEvent>();
  for (const ev of fromOdds) merged.set(ev.id, ev);

  for (const ev of fromEspn) {
    const existing = [...merged.values()].find(
      (e) =>
        e.id === ev.id ||
        (teamsMatchEvent(e, ev.home_team, ev.away_team) &&
          commenceTimesAlign(e.commence_time, ev.commence_time)),
    );
    if (!existing) {
      merged.set(ev.id, ev);
      continue;
    }
    if ((!existing.completed || !existing.scores?.length) && ev.completed && ev.scores?.length) {
      merged.set(existing.id, {
        ...existing,
        completed: true,
        scores: ev.scores,
        commence_time: existing.commence_time ?? ev.commence_time,
      });
    }
  }
  return [...merged.values()];
}

/**
 * Final scores: The Odds API first when keys work, ESPN scoreboard as fallback/merge.
 */
export async function fetchScoresForSport(
  sport: string | SportKey,
  daysFrom = 3,
): Promise<ScoreEvent[]> {
  const [fromOdds, fromEspn] = await Promise.all([
    fetchOddsApiScores(sport, daysFrom),
    fetchEspnScoresForSport(sport, daysFrom),
  ]);
  return mergeScoreEvents(fromOdds, fromEspn);
}

export function matchScoreEventByPick(
  pick: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    commenceTime?: string | null;
  },
  events: ScoreEvent[],
): ScoreEvent | null {
  const pickDay = gameDateKey(pick.commenceTime);
  if (!pickDay) return null;

  // Only consider games on the bet's listed slate day (CT).
  const sameDay = events.filter((e) => {
    if (!e.commence_time) return false;
    return gameDateKey(e.commence_time) === pickDay;
  });
  if (sameDay.length === 0) return null;

  const rawId = String(pick.eventId ?? "");
  const bareId = rawId.replace(/^espn-/i, "");
  const byId = sameDay.find(
    (e) => e.id === rawId || e.id === bareId || e.id === `espn-${bareId}`,
  );
  if (byId) return byId;

  const teamHits = sameDay.filter((e) => teamsMatchEvent(e, pick.homeTeam, pick.awayTeam));
  if (teamHits.length === 0) return null;
  if (teamHits.length === 1) return teamHits[0]!;

  const tip = Date.parse(String(pick.commenceTime ?? ""));
  if (!Number.isFinite(tip)) return teamHits[0]!;
  return [...teamHits].sort((a, b) => {
    const da = Math.abs(Date.parse(String(a.commence_time ?? "")) - tip);
    const db = Math.abs(Date.parse(String(b.commence_time ?? "")) - tip);
    return da - db;
  })[0]!;
}
