import type { Bookmaker, Market, OddsEvent, Outcome } from "./types";
import { GAME_DATE_TZ, gameDateKey } from "./pick-identity";

const ESPN_HEADERS: HeadersInit = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Referer: "https://www.espn.com/",
  Origin: "https://www.espn.com",
};

/** ESPN prop type ids we map into MintPicks markets. */
const TYPE_TOTAL_HITS = "53";
const TYPE_HR_MILESTONES = "240";

type EspnPropItem = {
  athlete?: { $ref?: string };
  type?: { id?: string | number; name?: string };
  odds?: {
    american?: { value?: string };
    total?: { value?: string };
  };
  current?: { target?: { value?: number | string; displayValue?: string } };
};

function bareEventId(eventId: string): string {
  return String(eventId).replace(/^espn-/i, "");
}

function parseAmerican(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[^\d+-]/g, "");
  if (!cleaned || cleaned === "+" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseLine(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  // "1+" milestone → 0.5 Over line in our board
  if (/^\d+\+$/.test(raw.trim())) {
    const n = Number(raw.trim().replace("+", ""));
    return Number.isFinite(n) && n >= 1 ? n - 0.5 : null;
  }
  const m = raw.trim().match(/([+-]?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** ESPN HR milestones post target 1 / 2 / … meaning 1+ / 2+ → board lines 0.5 / 1.5. */
function milestoneToBoardLine(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.trunc(raw) - 0.5;
  }
  if (typeof raw === "string") {
    const plus = raw.trim().match(/^(\d+)\+$/);
    if (plus) {
      const n = Number(plus[1]);
      return Number.isFinite(n) && n >= 1 ? n - 0.5 : null;
    }
    const plain = raw.trim().match(/^(\d+)(?:\.0+)?$/);
    if (plain) {
      const n = Number(plain[1]);
      return Number.isFinite(n) && n >= 1 ? n - 0.5 : null;
    }
  }
  return parseLine(raw);
}

function normTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(baseball|club|team)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normTeam(a);
  const nb = normTeam(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

/**
 * Odds API / Parlay event ids are not ESPN ids. Resolve via scoreboard team match.
 */
async function resolveEspnEventId(
  eventId: string,
  homeTeam: string,
  awayTeam: string,
): Promise<string | null> {
  if (/^espn-/i.test(eventId) || /^\d{8,}$/.test(String(eventId))) {
    return eventId.startsWith("espn-") ? eventId : `espn-${eventId}`;
  }
  const events = await fetchEspnMlbPropEvents(1);
  const hit = events.find(
    (e) => teamsMatch(e.home_team, homeTeam) && teamsMatch(e.away_team, awayTeam),
  );
  return hit?.id ?? null;
}

function americanToImplied(american: number): number {
  if (american === 0) return 0.5;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function impliedToAmerican(p: number): number {
  const clamped = Math.min(0.99, Math.max(0.01, p));
  if (clamped >= 0.5) return Math.round((-100 * clamped) / (1 - clamped));
  return Math.round((100 * (1 - clamped)) / clamped);
}

/** Rough two-way under when ESPN only posts a yes/milestone price. */
function synthesizeUnder(overAmerican: number): number {
  const overImp = americanToImplied(overAmerican);
  const underImp = Math.min(0.92, Math.max(0.08, 1.045 - overImp));
  return impliedToAmerican(underImp);
}

async function espnJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url.replace(/^http:\/\//i, "https://"), {
      cache: "no-store",
      headers: ESPN_HEADERS,
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function localYmd(d: Date): string {
  return gameDateKey(d.toISOString(), GAME_DATE_TZ).replace(/-/g, "");
}

export interface EspnPropEventMeta {
  id: string;
  sport_key: "baseball_mlb";
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

/** Upcoming + in-play MLB games from ESPN scoreboard (skips finals). */
export async function fetchEspnMlbPropEvents(days = 2): Promise<EspnPropEventMeta[]> {
  const out: EspnPropEventMeta[] = [];
  const now = new Date();
  for (let offset = 0; offset <= days; offset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    const dates = localYmd(day);
    const data = (await espnJson(
      `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dates}`,
    )) as { events?: Array<Record<string, unknown>> } | null;
    for (const ev of data?.events ?? []) {
      const status = ev.status as Record<string, unknown> | undefined;
      const statusType = status?.type as Record<string, unknown> | undefined;
      const state = String(statusType?.state ?? "").toLowerCase();
      if (statusType?.completed || state === "post") continue;
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
      const id = String(ev.id ?? "");
      if (!id || !homeTeam || !awayTeam) continue;
      out.push({
        id: `espn-${id}`,
        sport_key: "baseball_mlb",
        sport_title: "MLB",
        commence_time: String(ev.date ?? competition.date ?? ""),
        home_team: homeTeam,
        away_team: awayTeam,
      });
    }
  }
  const byId = new Map(out.map((e) => [e.id, e]));
  return [...byId.values()].sort(
    (a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time),
  );
}

async function resolveAthleteName(
  ref: string | undefined,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!ref) return null;
  const cached = cache.get(ref);
  if (cached) return cached;
  const data = (await espnJson(ref)) as Record<string, unknown> | null;
  const name = String(data?.displayName ?? data?.fullName ?? "").trim();
  if (!name) return null;
  cache.set(ref, name);
  return name;
}

async function listProviderIds(eventId: string): Promise<Array<{ id: string; name: string }>> {
  const bare = bareEventId(eventId);
  const data = (await espnJson(
    `https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${bare}/competitions/${bare}/odds`,
  )) as { items?: Array<Record<string, unknown>> } | null;
  const out: Array<{ id: string; name: string }> = [];
  for (const item of data?.items ?? []) {
    const provider = item.provider as Record<string, unknown> | undefined;
    const id = String(provider?.id ?? "");
    const name = String(provider?.name ?? provider?.displayName ?? "ESPN");
    if (id) out.push({ id, name });
  }
  if (out.length === 0) out.push({ id: "100", name: "DraftKings" });
  return out;
}

async function fetchAllPropItems(
  eventId: string,
  providerId: string,
): Promise<EspnPropItem[]> {
  const bare = bareEventId(eventId);
  const first = (await espnJson(
    `https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${bare}/competitions/${bare}/odds/${providerId}/propBets?limit=50&page=1&lang=en&region=us`,
  )) as { items?: EspnPropItem[]; pageCount?: number; count?: number } | null;
  if (!first?.items?.length) return [];

  const pageCount = Math.min(Number(first.pageCount) || 1, 20);
  const items = [...first.items];
  if (pageCount <= 1) return items;

  const pages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, i) =>
      espnJson(
        `https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${bare}/competitions/${bare}/odds/${providerId}/propBets?limit=50&page=${i + 2}&lang=en&region=us`,
      ),
    ),
  );
  for (const page of pages) {
    const rows = (page as { items?: EspnPropItem[] } | null)?.items;
    if (rows?.length) items.push(...rows);
  }
  return items;
}

type PairBucket = {
  athleteRef: string;
  typeId: string;
  line: number;
  prices: number[];
};

/**
 * Pull MLB player prop odds from ESPN (hits O/U + HR milestones) into Odds API shape.
 */
export async function fetchEspnMlbPropOdds(opts: {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}): Promise<OddsEvent | null> {
  const resolvedId =
    (await resolveEspnEventId(opts.eventId, opts.homeTeam, opts.awayTeam)) ?? opts.eventId;
  const providers = await listProviderIds(resolvedId);
  const athleteCache = new Map<string, string>();

  for (const provider of providers) {
    const rawItems = await fetchAllPropItems(resolvedId, provider.id);
    if (rawItems.length === 0) continue;

    const relevant = rawItems.filter((item) => {
      const tid = String(item.type?.id ?? "");
      return tid === TYPE_TOTAL_HITS || tid === TYPE_HR_MILESTONES;
    });
    if (relevant.length === 0) continue;

    const buckets = new Map<string, PairBucket>();
    for (const item of relevant) {
      const athleteRef = item.athlete?.$ref;
      const typeId = String(item.type?.id ?? "");
      if (!athleteRef || !typeId) continue;
      const price = parseAmerican(item.odds?.american?.value);
      if (price == null) continue;
      const rawTarget =
        item.current?.target?.value ??
        item.current?.target?.displayValue ??
        item.odds?.total?.value;
      const line =
        typeId === TYPE_HR_MILESTONES
          ? milestoneToBoardLine(rawTarget)
          : parseLine(rawTarget);
      if (line == null) continue;
      // HR milestones "1+" → 0.5; keep hits at posted line (usually 0.5)
      const key = `${athleteRef}::${typeId}::${line}`;
      const bucket = buckets.get(key) ?? {
        athleteRef,
        typeId,
        line,
        prices: [],
      };
      bucket.prices.push(price);
      buckets.set(key, bucket);
    }

    const hitOutcomes: Outcome[] = [];
    const hrOutcomes: Outcome[] = [];

    for (const bucket of buckets.values()) {
      const player = await resolveAthleteName(bucket.athleteRef, athleteCache);
      if (!player) continue;

      let over: number | null = null;
      let under: number | null = null;
      if (bucket.prices.length >= 2) {
        // ESPN posts Over then Under for two-way totals
        over = bucket.prices[0]!;
        under = bucket.prices[1]!;
      } else if (bucket.prices.length === 1) {
        over = bucket.prices[0]!;
        under = synthesizeUnder(over);
      } else {
        continue;
      }

      const marketOutcomes =
        bucket.typeId === TYPE_TOTAL_HITS
          ? hitOutcomes
          : bucket.typeId === TYPE_HR_MILESTONES
            ? hrOutcomes
            : null;
      if (!marketOutcomes) continue;

      marketOutcomes.push(
        { name: "Over", description: player, price: over, point: bucket.line },
        { name: "Under", description: player, price: under, point: bucket.line },
      );
    }

    const markets: Market[] = [];
    const now = new Date().toISOString();
    if (hitOutcomes.length) {
      markets.push({ key: "batter_hits", last_update: now, outcomes: hitOutcomes });
    }
    if (hrOutcomes.length) {
      markets.push({
        key: "batter_home_runs",
        last_update: now,
        outcomes: hrOutcomes,
      });
    }
    if (markets.length === 0) continue;

    const book: Bookmaker = {
      key: provider.name.toLowerCase().replace(/[^a-z0-9]/g, "") || "espn",
      title: provider.name,
      last_update: now,
      markets,
    };

    return {
      id: resolvedId.startsWith("espn-") ? resolvedId : `espn-${bareEventId(resolvedId)}`,
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: opts.commenceTime,
      home_team: opts.homeTeam,
      away_team: opts.awayTeam,
      bookmakers: [book],
    };
  }

  return null;
}
