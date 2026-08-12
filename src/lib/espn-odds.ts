import type { Bookmaker, Market, OddsEvent, SportKey } from "./types";
import { SPORT_OPTIONS } from "./odds-client";
import { GAME_DATE_TZ, gameDateKey } from "./pick-identity";

const ESPN_HEADERS: HeadersInit = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Referer: "https://www.espn.com/",
  Origin: "https://www.espn.com",
};

/** site.api path segment after /sports/ */
const ESPN_SITE_PATH: Record<SportKey, string> = {
  americanfootball_nfl: "football/nfl",
  basketball_nba: "basketball/nba",
  baseball_mlb: "baseball/mlb",
  icehockey_nhl: "hockey/nhl",
  americanfootball_ncaaf: "football/college-football",
  basketball_ncaab: "basketball/mens-college-basketball",
};

/** sports.core.api sport + league */
const ESPN_CORE: Record<SportKey, { sport: string; league: string }> = {
  americanfootball_nfl: { sport: "football", league: "nfl" },
  basketball_nba: { sport: "basketball", league: "nba" },
  baseball_mlb: { sport: "baseball", league: "mlb" },
  icehockey_nhl: { sport: "hockey", league: "nhl" },
  americanfootball_ncaaf: { sport: "football", league: "college-football" },
  basketball_ncaab: { sport: "basketball", league: "mens-college-basketball" },
};

const PROVIDER_KEYS: Record<string, string> = {
  draftkings: "draftkings",
  fanduel: "fanduel",
  betmgm: "betmgm",
  caesars: "caesars",
  williamhill: "caesars",
  "william hill": "caesars",
  espnbet: "espnbet",
  "espn bet": "espnbet",
  betrivers: "betrivers",
  pointsbet: "pointsbetus",
  bovada: "bovada",
};

type ScoreboardRow = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  books: Bookmaker[];
  needsCore: boolean;
  phase: "scheduled" | "in_progress" | "final";
};

function sportTitle(sport: SportKey): string {
  return SPORT_OPTIONS.find((s) => s.key === sport)?.label ?? sport;
}

/** YYYYMMDD in America/Chicago for ESPN scoreboard ?dates= */
function ymdSlate(d: Date): string {
  return gameDateKey(d.toISOString(), GAME_DATE_TZ).replace(/-/g, "");
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

function bookmakerKey(providerName: string): string {
  const lower = providerName.toLowerCase().trim();
  if (PROVIDER_KEYS[lower]) return PROVIDER_KEYS[lower]!;
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return PROVIDER_KEYS[compact] ?? (compact || "espn");
}

async function espnJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store", headers: ESPN_HEADERS });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function market(key: string, outcomes: Market["outcomes"]): Market | null {
  if (outcomes.length === 0) return null;
  return {
    key,
    last_update: new Date().toISOString(),
    outcomes,
  };
}

function closeOdds(
  side: Record<string, unknown> | undefined,
): { odds?: unknown; line?: unknown } {
  const close = side?.close as Record<string, unknown> | undefined;
  return { odds: close?.odds, line: close?.line };
}

/** Prefer scoreboard widget shape (moneyline / pointSpread / total). */
function bookFromEmbedded(
  raw: Record<string, unknown>,
  homeTeam: string,
  awayTeam: string,
): Bookmaker | null {
  const provider = (raw.provider as Record<string, unknown> | undefined) ?? {};
  const title = String(provider.displayName ?? provider.name ?? "ESPN");
  const key = bookmakerKey(title);
  const markets: Market[] = [];

  const ml = raw.moneyline as Record<string, unknown> | undefined;
  const homeOdds = raw.homeTeamOdds as Record<string, unknown> | undefined;
  const awayOdds = raw.awayTeamOdds as Record<string, unknown> | undefined;

  const mlHome =
    parseAmerican(closeOdds(ml?.home as Record<string, unknown> | undefined).odds) ??
    parseAmerican(homeOdds?.moneyLine);
  const mlAway =
    parseAmerican(closeOdds(ml?.away as Record<string, unknown> | undefined).odds) ??
    parseAmerican(awayOdds?.moneyLine);
  const h2h = market("h2h", [
    ...(mlHome != null ? [{ name: homeTeam, price: mlHome }] : []),
    ...(mlAway != null ? [{ name: awayTeam, price: mlAway }] : []),
  ]);
  if (h2h) markets.push(h2h);

  const ps = raw.pointSpread as Record<string, unknown> | undefined;
  const homeClose = closeOdds(ps?.home as Record<string, unknown> | undefined);
  const awayClose = closeOdds(ps?.away as Record<string, unknown> | undefined);
  let homePoint = parsePoint(homeClose.line);
  let awayPoint = parsePoint(awayClose.line);
  let homeSpreadPrice = parseAmerican(homeClose.odds);
  let awaySpreadPrice = parseAmerican(awayClose.odds);

  if (homePoint == null && typeof raw.spread === "number") {
    homePoint = Number(raw.spread);
    awayPoint = -homePoint;
  }

  if (homeSpreadPrice == null || awaySpreadPrice == null) {
    const hCur = homeOdds?.current as Record<string, unknown> | undefined;
    const aCur = awayOdds?.current as Record<string, unknown> | undefined;
    homePoint =
      homePoint ??
      parsePoint((hCur?.pointSpread as Record<string, unknown> | undefined)?.american);
    awayPoint =
      awayPoint ??
      parsePoint((aCur?.pointSpread as Record<string, unknown> | undefined)?.american);
    homeSpreadPrice =
      homeSpreadPrice ??
      parseAmerican((hCur?.spread as Record<string, unknown> | undefined)?.american);
    awaySpreadPrice =
      awaySpreadPrice ??
      parseAmerican((aCur?.spread as Record<string, unknown> | undefined)?.american);
  }

  const spreads = market("spreads", [
    ...(homePoint != null && homeSpreadPrice != null
      ? [{ name: homeTeam, price: homeSpreadPrice, point: homePoint }]
      : []),
    ...(awayPoint != null && awaySpreadPrice != null
      ? [{ name: awayTeam, price: awaySpreadPrice, point: awayPoint }]
      : []),
  ]);
  if (spreads) markets.push(spreads);

  const total = raw.total as Record<string, unknown> | undefined;
  const overClose = closeOdds(total?.over as Record<string, unknown> | undefined);
  const underClose = closeOdds(total?.under as Record<string, unknown> | undefined);
  const totalPoint =
    parsePoint(raw.overUnder) ?? parsePoint(overClose.line) ?? parsePoint(underClose.line);
  const overPrice = parseAmerican(overClose.odds) ?? parseAmerican(raw.overOdds);
  const underPrice = parseAmerican(underClose.odds) ?? parseAmerican(raw.underOdds);
  const totals = market("totals", [
    ...(totalPoint != null && overPrice != null
      ? [{ name: "Over", price: overPrice, point: totalPoint }]
      : []),
    ...(totalPoint != null && underPrice != null
      ? [{ name: "Under", price: underPrice, point: totalPoint }]
      : []),
  ]);
  if (totals) markets.push(totals);

  if (markets.length === 0) return null;
  return {
    key,
    title,
    last_update: new Date().toISOString(),
    markets,
  };
}

function bookFromCoreItem(
  raw: Record<string, unknown>,
  homeTeam: string,
  awayTeam: string,
): Bookmaker | null {
  const provider = (raw.provider as Record<string, unknown> | undefined) ?? {};
  const title = String(provider.name ?? "ESPN");
  const key = bookmakerKey(title);
  const markets: Market[] = [];

  const homeOdds = raw.homeTeamOdds as Record<string, unknown> | undefined;
  const awayOdds = raw.awayTeamOdds as Record<string, unknown> | undefined;
  const mlHome = parseAmerican(homeOdds?.moneyLine);
  const mlAway = parseAmerican(awayOdds?.moneyLine);
  const h2h = market("h2h", [
    ...(mlHome != null ? [{ name: homeTeam, price: mlHome }] : []),
    ...(mlAway != null ? [{ name: awayTeam, price: mlAway }] : []),
  ]);
  if (h2h) markets.push(h2h);

  const hCur = homeOdds?.current as Record<string, unknown> | undefined;
  const aCur = awayOdds?.current as Record<string, unknown> | undefined;
  let homePoint = parsePoint((hCur?.pointSpread as Record<string, unknown> | undefined)?.american);
  let awayPoint = parsePoint((aCur?.pointSpread as Record<string, unknown> | undefined)?.american);
  if (homePoint == null && typeof raw.spread === "number") {
    homePoint = Number(raw.spread);
    awayPoint = -homePoint;
  }
  const homeSpreadPrice = parseAmerican(
    (hCur?.spread as Record<string, unknown> | undefined)?.american,
  );
  const awaySpreadPrice = parseAmerican(
    (aCur?.spread as Record<string, unknown> | undefined)?.american,
  );
  const spreads = market("spreads", [
    ...(homePoint != null && homeSpreadPrice != null
      ? [{ name: homeTeam, price: homeSpreadPrice, point: homePoint }]
      : []),
    ...(awayPoint != null && awaySpreadPrice != null
      ? [{ name: awayTeam, price: awaySpreadPrice, point: awayPoint }]
      : []),
  ]);
  if (spreads) markets.push(spreads);

  const totalPoint = parsePoint(raw.overUnder);
  const overPrice = parseAmerican(raw.overOdds);
  const underPrice = parseAmerican(raw.underOdds);
  const totals = market("totals", [
    ...(totalPoint != null && overPrice != null
      ? [{ name: "Over", price: overPrice, point: totalPoint }]
      : []),
    ...(totalPoint != null && underPrice != null
      ? [{ name: "Under", price: underPrice, point: totalPoint }]
      : []),
  ]);
  if (totals) markets.push(totals);

  if (markets.length === 0) return null;
  return {
    key,
    title,
    last_update: new Date().toISOString(),
    markets,
  };
}

async function fetchCoreOddsBooks(
  sport: SportKey,
  eventId: string,
  homeTeam: string,
  awayTeam: string,
): Promise<Bookmaker[]> {
  const core = ESPN_CORE[sport];
  const url = `https://sports.core.api.espn.com/v2/sports/${core.sport}/leagues/${core.league}/events/${eventId}/competitions/${eventId}/odds`;
  const data = (await espnJson(url)) as { items?: Array<Record<string, unknown>> } | null;
  if (!data?.items?.length) return [];

  const books: Bookmaker[] = [];
  for (const item of data.items) {
    let raw = item;
    const ref = typeof item.$ref === "string" ? item.$ref : null;
    if (ref && !item.provider) {
      const resolved = (await espnJson(ref.replace(/^http:\/\//i, "https://"))) as Record<
        string,
        unknown
      > | null;
      if (!resolved) continue;
      raw = resolved;
    }
    const book = bookFromCoreItem(raw, homeTeam, awayTeam);
    if (book) books.push(book);
  }
  return books;
}

function mapScoreboardEvent(ev: Record<string, unknown>): ScoreboardRow | null {
  const competition = (ev.competitions as Array<Record<string, unknown>> | undefined)?.[0];
  if (!competition) return null;
  const competitors = (competition.competitors as Array<Record<string, unknown>>) ?? [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  const homeTeam = String(
    ((home?.team as Record<string, unknown> | undefined)?.displayName as string) ?? "",
  );
  const awayTeam = String(
    ((away?.team as Record<string, unknown> | undefined)?.displayName as string) ?? "",
  );
  if (!homeTeam || !awayTeam) return null;

  const id = String(ev.id ?? "");
  if (!id) return null;
  const commence_time = String(ev.date ?? competition.date ?? new Date().toISOString());

  const status = ev.status as Record<string, unknown> | undefined;
  const statusType = status?.type as Record<string, unknown> | undefined;
  const state = String(statusType?.state ?? "").toLowerCase();
  const name = String(statusType?.name ?? "").toUpperCase();
  let phase: ScoreboardRow["phase"] = "scheduled";
  if (statusType?.completed || state === "post" || name.includes("FINAL")) {
    phase = "final";
  } else if (state === "in" || name.includes("PROGRESS") || name.includes("HALFTIME")) {
    phase = "in_progress";
  }

  const embedded = Array.isArray(competition.odds)
    ? (competition.odds as Array<Record<string, unknown>>)
    : [];
  const books: Bookmaker[] = [];
  for (const row of embedded) {
    const book = bookFromEmbedded(row, homeTeam, awayTeam);
    if (book) books.push(book);
  }

  return {
    id,
    commence_time,
    home_team: homeTeam,
    away_team: awayTeam,
    books,
    // In-play scoreboard widgets often omit odds — always try core for live games.
    needsCore: books.length === 0 || phase === "in_progress",
    phase,
  };
}

/**
 * Pull ML / spread / total game lines from ESPN public scoreboards (no API key).
 * Covers today + next 2 days; fills missing lines from the core odds endpoint.
 */
export async function fetchEspnGameLines(sport: SportKey): Promise<{
  events: OddsEvent[];
  warning?: string;
}> {
  const sitePath = ESPN_SITE_PATH[sport];
  const title = sportTitle(sport);
  const now = new Date();
  const dateKeys = [0, 1, 2].map((offset) => {
    const d = new Date(now.getTime() + offset * 86_400_000);
    return ymdSlate(d);
  });

  const mapped: ScoreboardRow[] = [];
  for (const dates of dateKeys) {
    const data = (await espnJson(
      `https://site.api.espn.com/apis/site/v2/sports/${sitePath}/scoreboard?dates=${dates}`,
    )) as { events?: Array<Record<string, unknown>> } | null;
    const events = Array.isArray(data?.events) ? data!.events! : [];
    for (const ev of events) {
      const row = mapScoreboardEvent(ev);
      if (row) mapped.push(row);
    }
  }

  const byId = new Map<string, ScoreboardRow>();
  for (const row of mapped) {
    const prev = byId.get(row.id);
    if (!prev || row.books.length > prev.books.length) byId.set(row.id, row);
  }

  const rows = [...byId.values()].filter((r) => r.phase !== "final");
  // Prefer core odds for every in-progress game (up to 40), then other gaps.
  const needCore = [
    ...rows.filter((r) => r.phase === "in_progress"),
    ...rows.filter((r) => r.phase !== "in_progress" && r.needsCore),
  ]
    .filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
    .slice(0, 40);
  await Promise.all(
    needCore.map(async (row) => {
      const books = await fetchCoreOddsBooks(sport, row.id, row.home_team, row.away_team);
      if (books.length) {
        row.books = books;
        row.needsCore = false;
      }
    }),
  );

  const events: OddsEvent[] = rows
    .filter((r) => r.books.length > 0)
    .map((r) => ({
      id: `espn-${r.id}`,
      sport_key: sport,
      sport_title: title,
      commence_time: r.commence_time,
      home_team: r.home_team,
      away_team: r.away_team,
      bookmakers: r.books,
      gamePhase: r.phase,
    }));

  if (events.length === 0) {
    return {
      events: [],
      warning: "ESPN game lines unavailable for this slate (no odds on scoreboard).",
    };
  }

  const liveCount = events.filter((e) => e.gamePhase === "in_progress").length;
  const books = new Set(events.flatMap((e) => e.bookmakers.map((b) => b.title)));
  return {
    events,
    warning: `Using ESPN public lines (${events.length} games${liveCount ? ` · ${liveCount} in-play` : ""} · books: ${[...books].join(", ")}). Game results only — not player props. Not The Odds API.`,
  };
}
