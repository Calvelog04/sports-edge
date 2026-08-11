import type { OddsEvent, SportKey } from "./types";
import { SPORT_OPTIONS } from "./odds-client";
import { getOddsQuota, recordOddsQuota, type OddsQuotaSnapshot } from "./odds-quota";

export { SPORT_OPTIONS, DEFAULT_SPORT } from "./odds-client";

const ODDS_BASE = "https://api.the-odds-api.com/v4";

/** Short TTL so Edges / Best / Suggested / Calendar share one Odds API pull. */
export const ODDS_CACHE_TTL_MS = 60_000;

type CacheEntry<T> = { at: number; value: T; inflight?: Promise<T> };

const oddsCache = new Map<string, CacheEntry<unknown>>();

async function cacheGetOrSet<T>(key: string, loader: () => Promise<T>): Promise<{ value: T; fromCache: boolean }> {
  const hit = oddsCache.get(key) as CacheEntry<T> | undefined;
  if (hit?.inflight) {
    return { value: await hit.inflight, fromCache: false };
  }
  if (hit && Date.now() - hit.at <= ODDS_CACHE_TTL_MS) {
    return { value: hit.value, fromCache: true };
  }

  const inflight = loader()
    .then((value) => {
      oddsCache.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      oddsCache.delete(key);
      throw err;
    });

  oddsCache.set(key, { at: Date.now(), value: undefined as T, inflight });
  return { value: await inflight, fromCache: false };
}

export function hasOddsApiKey(): boolean {
  return Boolean(process.env.ODDS_API_KEY?.trim());
}

export function isProSport(sport: string): sport is SportKey {
  return SPORT_OPTIONS.some((s) => s.key === sport);
}

export type OddsFetchMeta = {
  fromCache: boolean;
  quota: OddsQuotaSnapshot;
};

async function oddsFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  await recordOddsQuota(res.headers);
  return res;
}

export async function fetchOdds(
  sport: SportKey,
  markets: string[] = ["h2h", "spreads", "totals"],
): Promise<{
  events: OddsEvent[];
  mode: "live" | "unavailable";
  warning?: string;
  fromCache: boolean;
  quota: OddsQuotaSnapshot;
}> {
  const key = process.env.ODDS_API_KEY?.trim();
  const quota = await getOddsQuota();

  if (!key) {
    return {
      events: [],
      mode: "unavailable",
      warning:
        "Add ODDS_API_KEY to .env.local for live FanDuel/DraftKings odds (free key: https://the-odds-api.com). Demo games are disabled.",
      fromCache: false,
      quota,
    };
  }

  const cacheKey = `odds:${sport}:${markets.slice().sort().join(",")}`;
  const { value: result, fromCache } = await cacheGetOrSet(cacheKey, async () => {
    const params = new URLSearchParams({
      apiKey: key,
      regions: "us",
      markets: markets.join(","),
      oddsFormat: "american",
      bookmakers: "fanduel,draftkings,betmgm,caesars,betrivers",
    });
    const url = `${ODDS_BASE}/sports/${sport}/odds?${params.toString()}`;
    const res = await oddsFetch(url);

    if (!res.ok) {
      const body = await res.text();
      return {
        events: [] as OddsEvent[],
        mode: "unavailable" as const,
        warning: `Odds API error (${res.status}): ${body.slice(0, 200)}. No fallback data — fix the key or quota.`,
      };
    }

    const events = (await res.json()) as OddsEvent[];
    const live = events.filter((e) => Array.isArray(e.bookmakers) && e.bookmakers.length > 0);
    return { events: live, mode: "live" as const };
  });

  return { ...result, fromCache, quota: await getOddsQuota() };
}

export interface OddsEventMeta {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

/** Lightweight event list (no odds) — used before per-game prop fetches. */
export async function fetchSportEvents(
  sport: SportKey,
): Promise<{ events: OddsEventMeta[]; warning?: string; fromCache: boolean }> {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) {
    return {
      events: [],
      warning: "Add ODDS_API_KEY to .env.local for live prop odds.",
      fromCache: false,
    };
  }

  const cacheKey = `events:${sport}`;
  const { value: result, fromCache } = await cacheGetOrSet(cacheKey, async () => {
    const url = `${ODDS_BASE}/sports/${sport}/events?apiKey=${encodeURIComponent(key)}`;
    const res = await oddsFetch(url);
    if (!res.ok) {
      const body = await res.text();
      return {
        events: [] as OddsEventMeta[],
        warning: `Odds API events error (${res.status}): ${body.slice(0, 200)}`,
      };
    }
    const events = (await res.json()) as OddsEventMeta[];
    return { events: Array.isArray(events) ? events : [] };
  });

  return { ...result, fromCache };
}

/** Player props / period markets require the per-event odds endpoint. */
export async function fetchEventOdds(
  sport: SportKey,
  eventId: string,
  markets: string[],
): Promise<OddsEvent | null> {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) return null;

  const cacheKey = `eventOdds:${sport}:${eventId}:${markets.slice().sort().join(",")}`;
  const { value } = await cacheGetOrSet(cacheKey, async () => {
    const params = new URLSearchParams({
      apiKey: key,
      regions: "us",
      markets: markets.join(","),
      oddsFormat: "american",
      bookmakers: "fanduel,draftkings,betmgm,caesars,betrivers",
    });
    const url = `${ODDS_BASE}/sports/${sport}/events/${eventId}/odds?${params.toString()}`;
    const res = await oddsFetch(url);
    if (!res.ok) return { event: null as OddsEvent | null };
    const data = (await res.json()) as OddsEvent;
    if (!data?.id || !Array.isArray(data.bookmakers)) return { event: null };
    return { event: data };
  });
  return value.event;
}

/** American odds → implied probability (no vig removal). */
export function americanToImplied(american: number): number {
  if (american === 0) return 0.5;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/** Remove two-way vig from a pair of implied probs. */
export function removeVig(pA: number, pB: number): [number, number] {
  const total = pA + pB;
  if (total <= 0) return [0.5, 0.5];
  return [pA / total, pB / total];
}

export function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}
