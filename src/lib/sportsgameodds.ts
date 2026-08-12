import type { Bookmaker, Market, OddsEvent, Outcome, SportKey } from "./types";
import { SPORT_OPTIONS } from "./odds-client";

const SGO_BASE = "https://api.sportsgameodds.com/v2";

/** Core full-game markets only — keeps amateur entity usage low. */
const CORE_ODD_IDS = [
  "points-home-game-ml-home",
  "points-away-game-ml-away",
  "points-home-game-sp-home",
  "points-away-game-sp-away",
  "points-all-game-ou-over",
  "points-all-game-ou-under",
].join(",");

const LEAGUE_ID: Record<SportKey, string> = {
  baseball_mlb: "MLB",
  basketball_nba: "NBA",
  americanfootball_nfl: "NFL",
  icehockey_nhl: "NHL",
  americanfootball_ncaaf: "NCAAF",
  basketball_ncaab: "NCAAB",
};

const BOOK_TITLE: Record<string, string> = {
  fanduel: "FanDuel",
  draftkings: "DraftKings",
  betmgm: "BetMGM",
  caesars: "Caesars",
  betrivers: "BetRivers",
  espnbet: "ESPN BET",
  pointsbet: "PointsBet",
  pointsbetus: "PointsBet",
  bovada: "Bovada",
  unibet: "Unibet",
};

/** Prefer US books MintPicks already surfaces. */
const PREFERRED_BOOKS = new Set([
  "fanduel",
  "draftkings",
  "betmgm",
  "caesars",
  "betrivers",
  "espnbet",
  "pointsbet",
  "bovada",
]);

type SgoTeam = {
  names?: { long?: string; medium?: string; short?: string };
};

type SgoBookLine = {
  odds?: string;
  spread?: string;
  overUnder?: string;
  available?: boolean;
  lastUpdatedAt?: string;
};

type SgoOdd = {
  oddID?: string;
  betTypeID?: string;
  sideID?: string;
  bookOdds?: string;
  bookSpread?: string;
  bookOverUnder?: string;
  byBookmaker?: Record<string, SgoBookLine>;
};

type SgoEvent = {
  eventID: string;
  leagueID?: string;
  teams?: { home?: SgoTeam; away?: SgoTeam };
  status?: {
    startsAt?: string;
    started?: boolean;
    live?: boolean;
    ended?: boolean;
    completed?: boolean;
    cancelled?: boolean;
    finalized?: boolean;
  };
  odds?: Record<string, SgoOdd>;
};

function sportTitle(sport: SportKey): string {
  return SPORT_OPTIONS.find((s) => s.key === sport)?.label ?? sport;
}

export function hasSgoApiKey(): boolean {
  return Boolean(process.env.SGO_API_KEY?.trim() || process.env.SPORTSGAMEODDS_API_KEY?.trim());
}

function sgoApiKey(): string | null {
  const key =
    process.env.SGO_API_KEY?.trim() || process.env.SPORTSGAMEODDS_API_KEY?.trim() || "";
  return key || null;
}

function parseAmerican(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[^\d+-]/g, "");
  if (!cleaned || cleaned === "+" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parsePoint(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/([+-]?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function bookKey(id: string): string {
  if (id === "pointsbet") return "pointsbetus";
  return id;
}

function bookTitle(id: string): string {
  return BOOK_TITLE[id] ?? BOOK_TITLE[bookKey(id)] ?? id;
}

function teamName(team: SgoTeam | undefined, fallback: string): string {
  return team?.names?.long || team?.names?.medium || team?.names?.short || fallback;
}

function phaseOf(ev: SgoEvent): "scheduled" | "in_progress" | "final" {
  const s = ev.status;
  if (!s) return "scheduled";
  if (s.cancelled || s.finalized || s.ended || s.completed) return "final";
  if (s.live || s.started) return "in_progress";
  return "scheduled";
}

async function sgoGet(pathAndQuery: string): Promise<unknown> {
  const key = sgoApiKey();
  if (!key) throw new Error("No SGO_API_KEY configured");

  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${SGO_BASE}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "x-api-key": key,
    },
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : text.slice(0, 200);
    throw new Error(`SportsGameOdds error (${res.status}): ${msg}`);
  }

  return body;
}

async function fetchLeagueEvents(leagueID: string): Promise<SgoEvent[]> {
  const now = Date.now();
  const startsAfter = new Date(now - 6 * 60 * 60 * 1000).toISOString();
  const startsBefore = new Date(now + 48 * 60 * 60 * 1000).toISOString();

  const out: SgoEvent[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      leagueID,
      oddsAvailable: "true",
      finalized: "false",
      cancelled: "false",
      limit: "50",
      oddID: CORE_ODD_IDS,
      includeOpposingOdds: "true",
      startsAfter,
      startsBefore,
    });
    if (cursor) params.set("cursor", cursor);

    const body = (await sgoGet(`/events?${params.toString()}`)) as {
      success?: boolean;
      data?: SgoEvent[];
      nextCursor?: string | null;
    };

    const batch = Array.isArray(body.data) ? body.data : [];
    out.push(...batch);
    cursor = body.nextCursor || null;
    pages += 1;
  } while (cursor && pages < 4 && out.length < 80);

  return out;
}

function outcomesFromOdd(
  odd: SgoOdd,
  homeTeam: string,
  awayTeam: string,
): { bookId: string; outcome: Outcome; lastUpdate: string }[] {
  const bet = odd.betTypeID;
  const side = odd.sideID;
  if (!bet || !side) return [];

  let name: string;
  if (bet === "ml" || bet === "sp") {
    name = side === "home" ? homeTeam : awayTeam;
  } else if (bet === "ou") {
    name = side === "over" ? "Over" : "Under";
  } else {
    return [];
  }

  const rows: { bookId: string; outcome: Outcome; lastUpdate: string }[] = [];
  const books = odd.byBookmaker ?? {};

  for (const [id, line] of Object.entries(books)) {
    if (!PREFERRED_BOOKS.has(id)) continue;
    if (line.available === false) continue;
    const price = parseAmerican(line.odds ?? odd.bookOdds);
    if (price == null) continue;

    let point: number | undefined;
    if (bet === "sp") {
      const p = parsePoint(line.spread ?? odd.bookSpread);
      if (p == null) continue;
      point = p;
    } else if (bet === "ou") {
      const p = parsePoint(line.overUnder ?? odd.bookOverUnder);
      if (p == null) continue;
      point = p;
    }

    rows.push({
      bookId: bookKey(id),
      lastUpdate: line.lastUpdatedAt || new Date().toISOString(),
      outcome: point != null ? { name, price, point } : { name, price },
    });
  }

  return rows;
}

function marketKeyFor(betTypeID: string | undefined): "h2h" | "spreads" | "totals" | null {
  if (betTypeID === "ml") return "h2h";
  if (betTypeID === "sp") return "spreads";
  if (betTypeID === "ou") return "totals";
  return null;
}

function toOddsEvent(sport: SportKey, ev: SgoEvent): OddsEvent | null {
  const homeTeam = teamName(ev.teams?.home, "Home");
  const awayTeam = teamName(ev.teams?.away, "Away");
  const commence = ev.status?.startsAt;
  if (!commence || !ev.eventID) return null;

  const phase = phaseOf(ev);
  if (phase === "final") return null;

  type Acc = {
    title: string;
    last_update: string;
    markets: Map<string, { last_update: string; outcomes: Map<string, Outcome> }>;
  };
  const byBook = new Map<string, Acc>();

  for (const odd of Object.values(ev.odds ?? {})) {
    const mKey = marketKeyFor(odd.betTypeID);
    if (!mKey) continue;
    for (const row of outcomesFromOdd(odd, homeTeam, awayTeam)) {
      let book = byBook.get(row.bookId);
      if (!book) {
        book = {
          title: bookTitle(row.bookId === "pointsbetus" ? "pointsbet" : row.bookId),
          last_update: row.lastUpdate,
          markets: new Map(),
        };
        byBook.set(row.bookId, book);
      }
      if (row.lastUpdate > book.last_update) book.last_update = row.lastUpdate;

      let market = book.markets.get(mKey);
      if (!market) {
        market = { last_update: row.lastUpdate, outcomes: new Map() };
        book.markets.set(mKey, market);
      }
      if (row.lastUpdate > market.last_update) market.last_update = row.lastUpdate;

      const oKey =
        row.outcome.point != null
          ? `${row.outcome.name}|${row.outcome.point}`
          : row.outcome.name;
      market.outcomes.set(oKey, row.outcome);
    }
  }

  const bookmakers: Bookmaker[] = [];
  for (const [key, book] of byBook) {
    const markets: Market[] = [];
    for (const [mKey, m] of book.markets) {
      const outcomes = [...m.outcomes.values()];
      if (outcomes.length === 0) continue;
      markets.push({ key: mKey, last_update: m.last_update, outcomes });
    }
    if (markets.length === 0) continue;
    bookmakers.push({
      key,
      title: book.title,
      last_update: book.last_update,
      markets,
    });
  }

  if (bookmakers.length === 0) return null;

  return {
    id: `sgo:${ev.eventID}`,
    sport_key: sport,
    sport_title: sportTitle(sport),
    commence_time: commence,
    home_team: homeTeam,
    away_team: awayTeam,
    bookmakers,
    gamePhase: phase,
  };
}

export async function fetchSgoGameLines(sport: SportKey): Promise<{
  events: OddsEvent[];
  warning: string;
}> {
  const leagueID = LEAGUE_ID[sport];
  if (!leagueID) {
    return { events: [], warning: `SportsGameOdds has no league mapping for ${sport}.` };
  }

  const raw = await fetchLeagueEvents(leagueID);
  const events = raw
    .map((ev) => toOddsEvent(sport, ev))
    .filter((e): e is OddsEvent => e != null);

  const live = events.filter((e) => e.gamePhase === "in_progress").length;
  const books = new Set(
    events.flatMap((e) => e.bookmakers.map((b) => b.title)),
  );

  return {
    events,
    warning:
      events.length === 0
        ? `SportsGameOdds returned no ${leagueID} game lines.`
        : `Using SportsGameOdds (${events.length} games · ${live} in-play · books: ${[...books].sort().join(", ") || "n/a"}). Amateur plan is entity-capped — lines are cached.`,
  };
}
