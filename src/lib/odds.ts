import type { OddsEvent, SportKey } from "./types";
import { SPORT_OPTIONS } from "./odds-client";
import {
  hasOddsApiKey,
  isQuotaFailure,
  listOddsApiKeys,
  markKeyExhausted,
  setActiveKeyIndex,
} from "./odds-keys";
import {
  formatNextOddsRefresh,
  readOddsDiskCache,
  shouldNetworkFetchOdds,
  withScheduledOddsPull,
  writeOddsDiskCache,
} from "./odds-schedule";
import { getOddsQuota, recordOddsQuota, type OddsQuotaSnapshot } from "./odds-quota";

export { SPORT_OPTIONS, DEFAULT_SPORT, getActiveSportOptions } from "./odds-client";
export { hasOddsApiKey } from "./odds-keys";

const ODDS_BASE = "https://api.the-odds-api.com/v4";

/** In-memory TTL within a refresh hour; disk schedule covers the rest of the day. */
export const ODDS_CACHE_TTL_MS = 60 * 60 * 1000;
/** ESPN public lines (no paid credits) — can refresh more often. */
export const ESPN_ODDS_CACHE_TTL_MS = 2 * 60 * 1000;
/** Paid providers (Parlay / SGO) — memory hint only; disk slot gate is the real credit cap. */
export const SGO_ODDS_CACHE_TTL_MS = ODDS_CACHE_TTL_MS;
export const PARLAY_ODDS_CACHE_TTL_MS = ODDS_CACHE_TTL_MS;

type CacheEntry<T> = { at: number; value: T; inflight?: Promise<T> };

const oddsCache = new Map<string, CacheEntry<unknown>>();

async function cacheGetOrSet<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = ODDS_CACHE_TTL_MS,
): Promise<{ value: T; fromCache: boolean }> {
  const hit = oddsCache.get(key) as CacheEntry<T> | undefined;
  if (hit?.inflight) {
    return { value: await hit.inflight, fromCache: false };
  }
  if (hit && Date.now() - hit.at <= ttlMs) {
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

export function isProSport(sport: string): sport is SportKey {
  return SPORT_OPTIONS.some((s) => s.key === sport);
}

export type OddsFetchMeta = {
  fromCache: boolean;
  quota: OddsQuotaSnapshot;
};

function remainingFrom(headers: Headers): number | null {
  const v = headers.get("x-requests-remaining");
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch The Odds API with:
 * - 12×/day schedule (hourly 10am–9pm local) + disk cache otherwise
 * - automatic key rotation when a key is out of credits
 */
export async function oddsApiFetch(
  buildUrl: (apiKey: string) => string,
): Promise<Response> {
  const keys = listOddsApiKeys();
  if (keys.length === 0) {
    return new Response(JSON.stringify({ message: "No ODDS_API_KEY configured" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build URL with a placeholder key for cache identity (stripped in schedule helpers)
  const probeUrl = buildUrl(keys[0]!);
  const gate = await shouldNetworkFetchOdds(probeUrl);

  if (!gate.allow) {
    const cached = await readOddsDiskCache(probeUrl);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-mintpicks-schedule", gate.reason);
      return new Response(cached.body, { status: cached.status, headers });
    }
    return new Response(
      JSON.stringify({
        message: `${gate.reason} ${formatNextOddsRefresh()} No cached odds yet for this request.`,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const { getOddsKeysState } = await import("./odds-keys");
  const startState = await getOddsKeysState();

  const order: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const idx = (startState.activeIndex + i) % keys.length;
    if (!startState.exhausted.includes(idx)) order.push(idx);
  }
  for (let i = 0; i < keys.length; i++) {
    const idx = (startState.activeIndex + i) % keys.length;
    if (!order.includes(idx)) order.push(idx);
  }

  let lastRes: Response | null = null;

  for (const idx of order) {
    const url = buildUrl(keys[idx]!);
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    await recordOddsQuota(res.headers, { keyIndex: idx, keyCount: keys.length });
    lastRes = res;

    const remaining = remainingFrom(res.headers);

    if (res.ok) {
      await setActiveKeyIndex(idx);
      if (remaining === 0) {
        await markKeyExhausted(idx);
      }
      if (gate.slotId) {
        await writeOddsDiskCache(url, res, gate.slotId);
      }
      return res;
    }

    const body = await res.clone().text();
    // Invalid keys: skip and try the next key (do not mark as quota-exhausted).
    const lower = body.toLowerCase();
    if (lower.includes("invalid_key") || lower.includes("api key is not valid")) {
      continue;
    }
    if (isQuotaFailure(res.status, body) || remaining === 0) {
      await markKeyExhausted(idx);
      continue;
    }

    return res;
  }

  const cached = await readOddsDiskCache(probeUrl);
  if (cached) return cached;

  return (
    lastRes ??
    new Response(JSON.stringify({ message: "All Odds API keys exhausted" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    })
  );
}

export type OddsLineSource = "odds-api" | "parlay" | "sportsgameodds" | "espn";

export async function fetchOdds(
  sport: SportKey,
  markets: string[] = ["h2h", "spreads", "totals"],
  opts?: { timing?: "live" | "upcoming" },
): Promise<{
  events: OddsEvent[];
  mode: "live" | "unavailable";
  warning?: string;
  fromCache: boolean;
  quota: OddsQuotaSnapshot;
  source?: OddsLineSource;
}> {
  const quota = await getOddsQuota();
  const liveBoard = opts?.timing === "live";

  const { isSportInSeason } = await import("./sports-season");
  if (!isSportInSeason(sport)) {
    return {
      events: [],
      mode: "unavailable",
      warning: `${sport} is out of season (boards turn on 1 week before opening day).`,
      fromCache: false,
      quota,
    };
  }

  // Live board: ESPN public in-play lines only — never spend paid API credits.
  if (liveBoard) {
    const espnCacheKey = `espn-odds:live:${sport}`;
    try {
      const { value: espn, fromCache } = await cacheGetOrSet(
        espnCacheKey,
        async () => {
          const { fetchEspnGameLines } = await import("./espn-odds");
          return fetchEspnGameLines(sport);
        },
        ESPN_ODDS_CACHE_TTL_MS,
      );
      const events = espn.events.filter((e) => e.gamePhase === "in_progress");
      if (events.length > 0) {
        return {
          events,
          mode: "live",
          warning: "Live board: ESPN in-play game lines only (no Odds API / Parlay / SportsGameOdds).",
          fromCache,
          quota: await getOddsQuota(),
          source: "espn",
        };
      }
      return {
        events: [],
        mode: "unavailable",
        warning: espn.warning || "No ESPN in-play game lines right now.",
        fromCache,
        quota: await getOddsQuota(),
        source: "espn",
      };
    } catch (err) {
      const espnErr = err instanceof Error ? err.message : "ESPN live odds failed";
      return {
        events: [],
        mode: "unavailable",
        warning: espnErr,
        fromCache: false,
        quota: await getOddsQuota(),
      };
    }
  }

  let oddsApiWarning: string | undefined;

  if (hasOddsApiKey()) {
    const cacheKey = `odds:${sport}:${markets.slice().sort().join(",")}`;
    try {
      const { value: result, fromCache } = await cacheGetOrSet(cacheKey, async () => {
        const res = await oddsApiFetch((apiKey) => {
          const params = new URLSearchParams({
            apiKey,
            regions: "us",
            markets: markets.join(","),
            oddsFormat: "american",
            bookmakers: "fanduel,draftkings,betmgm,caesars,betrivers",
          });
          return `${ODDS_BASE}/sports/${sport}/odds?${params.toString()}`;
        });

        if (!res.ok) {
          const body = await res.text();
          const keys = listOddsApiKeys();
          if (res.status === 503 && body.includes("Outside daily odds window")) {
            throw new Error(body.slice(0, 240));
          }
          if (res.status === 503 && body.includes("Already pulled this hour")) {
            throw new Error(body.slice(0, 240));
          }
          // Throw so the in-memory cache does not keep a failed response for an hour.
          throw new Error(
            `Odds API error (${res.status}): ${body.slice(0, 200)}. Tried ${keys.length} key(s).`,
          );
        }

        const events = (await res.json()) as OddsEvent[];
        const { phaseFromCommence } = await import("./timing");
        const live = events
          .filter((e) => Array.isArray(e.bookmakers) && e.bookmakers.length > 0)
          .map((e) => ({
            ...e,
            gamePhase: e.gamePhase ?? phaseFromCommence(e.commence_time),
          }))
          .filter((e) => e.gamePhase !== "final");
        if (live.length === 0) {
          throw new Error("Odds API returned no bookmaker lines.");
        }
        return { events: live, mode: "live" as const };
      });

      return {
        ...result,
        fromCache,
        quota: await getOddsQuota(),
        source: "odds-api",
      };
    } catch (err) {
      oddsApiWarning = err instanceof Error ? err.message : "Odds API fetch failed";
    }
  } else {
    oddsApiWarning =
      "No ODDS_API_KEY — trying ParlayAPI / SportsGameOdds / ESPN for game lines.";
  }

  const { hasParlayApiKey } = await import("./parlay-api");
  if (hasParlayApiKey()) {
    const parlayCacheKey = `parlay-odds:${sport}:${markets.slice().sort().join(",")}`;
    try {
      const { value: parlay, fromCache } = await cacheGetOrSet(
        parlayCacheKey,
        async () => {
          const scheduled = await withScheduledOddsPull(parlayCacheKey, async () => {
            const { fetchParlayGameLines } = await import("./parlay-api");
            return fetchParlayGameLines(sport, markets);
          });
          if (!scheduled) throw new Error("ODDS_SCHEDULE_MISS");
          return {
            ...scheduled.value,
            warning: [scheduled.value.warning, scheduled.fromCache ? scheduled.reason : null]
              .filter(Boolean)
              .join(" · "),
            _scheduledFromCache: scheduled.fromCache,
          };
        },
        PARLAY_ODDS_CACHE_TTL_MS,
      );

      if (parlay.events.length > 0) {
        const warning = [oddsApiWarning, parlay.warning].filter(Boolean).join(" · ");
        return {
          events: parlay.events,
          mode: "live",
          warning,
          fromCache: fromCache || Boolean(parlay._scheduledFromCache),
          quota: await getOddsQuota(),
          source: "parlay",
        };
      }
    } catch (err) {
      const parlayErr = err instanceof Error ? err.message : "ParlayAPI fetch failed";
      if (parlayErr !== "ODDS_SCHEDULE_MISS") {
        oddsApiWarning = [oddsApiWarning, parlayErr].filter(Boolean).join(" · ");
      }
    }
  }

  const { hasSgoApiKey } = await import("./sportsgameodds");
  if (hasSgoApiKey()) {
    const sgoCacheKey = `sgo-odds:${sport}`;
    try {
      const { value: sgo, fromCache } = await cacheGetOrSet(
        sgoCacheKey,
        async () => {
          const scheduled = await withScheduledOddsPull(sgoCacheKey, async () => {
            const { fetchSgoGameLines } = await import("./sportsgameodds");
            return fetchSgoGameLines(sport);
          });
          if (!scheduled) throw new Error("ODDS_SCHEDULE_MISS");
          return {
            ...scheduled.value,
            warning: [scheduled.value.warning, scheduled.fromCache ? scheduled.reason : null]
              .filter(Boolean)
              .join(" · "),
            _scheduledFromCache: scheduled.fromCache,
          };
        },
        SGO_ODDS_CACHE_TTL_MS,
      );

      if (sgo.events.length > 0) {
        const warning = [oddsApiWarning, sgo.warning].filter(Boolean).join(" · ");
        return {
          events: sgo.events,
          mode: "live",
          warning,
          fromCache: fromCache || Boolean(sgo._scheduledFromCache),
          quota: await getOddsQuota(),
          source: "sportsgameodds",
        };
      }
    } catch (err) {
      const sgoErr = err instanceof Error ? err.message : "SportsGameOdds fetch failed";
      if (sgoErr !== "ODDS_SCHEDULE_MISS") {
        oddsApiWarning = [oddsApiWarning, sgoErr].filter(Boolean).join(" · ");
      }
    }
  }

  const espnCacheKey = `espn-odds:${sport}`;
  try {
    const { value: espn, fromCache } = await cacheGetOrSet(
      espnCacheKey,
      async () => {
        const { fetchEspnGameLines } = await import("./espn-odds");
        return fetchEspnGameLines(sport);
      },
      ESPN_ODDS_CACHE_TTL_MS,
    );

    if (espn.events.length > 0) {
      const warning = [oddsApiWarning, espn.warning].filter(Boolean).join(" · ");
      return {
        events: espn.events,
        mode: "live",
        warning,
        fromCache,
        quota: await getOddsQuota(),
        source: "espn",
      };
    }

    return {
      events: [],
      mode: "unavailable",
      warning: [oddsApiWarning, espn.warning].filter(Boolean).join(" · ") || "No game lines available.",
      fromCache,
      quota: await getOddsQuota(),
    };
  } catch (err) {
    const espnErr = err instanceof Error ? err.message : "ESPN odds fallback failed";
    return {
      events: [],
      mode: "unavailable",
      warning: [oddsApiWarning, espnErr].filter(Boolean).join(" · "),
      fromCache: false,
      quota: await getOddsQuota(),
    };
  }
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
  opts?: { source?: "credits" | "espn" },
): Promise<{
  events: OddsEventMeta[];
  warning?: string;
  fromCache: boolean;
  source?: "odds-api" | "parlay" | "espn";
}> {
  const espnOnly = opts?.source === "espn";
  let lastWarning: string | undefined;

  if (!espnOnly && hasOddsApiKey()) {
    const cacheKey = `events:${sport}`;
    try {
      const { value: result, fromCache } = await cacheGetOrSet(cacheKey, async () => {
        const res = await oddsApiFetch(
          (apiKey) =>
            `${ODDS_BASE}/sports/${sport}/events?apiKey=${encodeURIComponent(apiKey)}`,
        );
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Odds API events error (${res.status}): ${body.slice(0, 200)}`);
        }
        const events = (await res.json()) as OddsEventMeta[];
        if (!Array.isArray(events) || events.length === 0) {
          throw new Error("Odds API returned no events.");
        }
        return { events };
      });
      return { ...result, fromCache, source: "odds-api" };
    } catch (err) {
      lastWarning = err instanceof Error ? err.message : "Events fetch failed";
    }
  }

  if (!espnOnly) {
    const { hasParlayApiKey } = await import("./parlay-api");
    if (hasParlayApiKey()) {
      const cacheKey = `events:parlay:${sport}`;
      try {
        const { value, fromCache } = await cacheGetOrSet(
          cacheKey,
          async () => {
            const scheduled = await withScheduledOddsPull(cacheKey, async () => {
              const { fetchParlaySportEvents } = await import("./parlay-api");
              return fetchParlaySportEvents(sport);
            });
            if (!scheduled) throw new Error("ODDS_SCHEDULE_MISS");
            return {
              events: scheduled.value.events,
              warning: [
                scheduled.value.warning,
                scheduled.fromCache ? scheduled.reason : null,
              ]
                .filter(Boolean)
                .join(" · "),
              _scheduledFromCache: scheduled.fromCache,
            };
          },
          PARLAY_ODDS_CACHE_TTL_MS,
        );
        if (value.events.length > 0) {
          return {
            events: value.events,
            warning: [lastWarning, value.warning].filter(Boolean).join(" · ") || undefined,
            fromCache: fromCache || Boolean(value._scheduledFromCache),
            source: "parlay",
          };
        }
        lastWarning = [lastWarning, value.warning].filter(Boolean).join(" · ");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "ParlayAPI events failed";
        if (msg !== "ODDS_SCHEDULE_MISS") {
          lastWarning = [lastWarning, msg].filter(Boolean).join(" · ");
        }
      }
    }
  }

  if (sport === "baseball_mlb") {
    const cacheKey = espnOnly
      ? `events:espn:baseball_mlb:props-espn`
      : `events:espn:baseball_mlb`;
    const { value, fromCache } = await cacheGetOrSet(
      cacheKey,
      async () => {
        const { fetchEspnMlbPropEvents } = await import("./espn-props");
        const events = await fetchEspnMlbPropEvents(2);
        return {
          events: events.map((e) => ({
            id: e.id,
            sport_key: e.sport_key,
            sport_title: e.sport_title,
            commence_time: e.commence_time,
            home_team: e.home_team,
            away_team: e.away_team,
          })),
          warning:
            events.length > 0
              ? `Using ESPN scoreboard for MLB event list (${events.length} games).`
              : "ESPN scoreboard returned no upcoming MLB games.",
        };
      },
      espnOnly ? ESPN_ODDS_CACHE_TTL_MS : ODDS_CACHE_TTL_MS,
    );
    return {
      events: value.events,
      warning: [lastWarning, value.warning].filter(Boolean).join(" · ") || undefined,
      fromCache,
      source: "espn",
    };
  }

  return {
    events: [],
    warning:
      lastWarning ||
      "Add ODDS_API_KEY or PARLAY_API_KEY to .env.local for live prop odds.",
    fromCache: false,
  };
}

/** Player props / period markets require the per-event odds endpoint. */
export async function fetchEventOdds(
  sport: SportKey,
  eventId: string,
  markets: string[],
  meta?: {
    homeTeam?: string;
    awayTeam?: string;
    commenceTime?: string;
    source?: "credits" | "espn";
  },
): Promise<OddsEvent | null> {
  const espnOnly = meta?.source === "espn";

  if (
    !espnOnly &&
    hasOddsApiKey() &&
    !String(eventId).startsWith("espn-") &&
    !String(eventId).startsWith("sgo:")
  ) {
    const cacheKey = `eventOdds:${sport}:${eventId}:${markets.slice().sort().join(",")}`;
    try {
      const { value } = await cacheGetOrSet(cacheKey, async () => {
        const res = await oddsApiFetch((apiKey) => {
          const params = new URLSearchParams({
            apiKey,
            regions: "us",
            markets: markets.join(","),
            oddsFormat: "american",
            bookmakers: "fanduel,draftkings,betmgm,caesars,betrivers",
          });
          return `${ODDS_BASE}/sports/${sport}/events/${eventId}/odds?${params.toString()}`;
        });
        if (!res.ok) throw new Error(`event odds ${res.status}`);
        const data = (await res.json()) as OddsEvent;
        if (!data?.id || !Array.isArray(data.bookmakers) || data.bookmakers.length === 0) {
          throw new Error("empty bookmakers");
        }
        return { event: data };
      });
      if (value.event) {
        const hasProps = value.event.bookmakers.some((b) =>
          b.markets?.some(
            (m) => markets.includes(m.key) && (m.outcomes?.length ?? 0) > 0,
          ),
        );
        if (hasProps) return value.event;
      }
    } catch {
      // Parlay / ESPN fallback below
    }
  }

  if (
    !espnOnly &&
    !String(eventId).startsWith("espn-") &&
    !String(eventId).startsWith("sgo:")
  ) {
    const { hasParlayApiKey } = await import("./parlay-api");
    if (hasParlayApiKey()) {
      const cacheKey = `eventOdds:parlay:${sport}:${eventId}:${markets.slice().sort().join(",")}`;
      try {
        const { value } = await cacheGetOrSet(
          cacheKey,
          async () => {
            const scheduled = await withScheduledOddsPull(cacheKey, async () => {
              const { fetchParlayEventOdds } = await import("./parlay-api");
              const event = await fetchParlayEventOdds(sport, eventId, markets);
              return { event };
            });
            if (!scheduled) return { event: null };
            return scheduled.value;
          },
          PARLAY_ODDS_CACHE_TTL_MS,
        );
        if (value.event?.bookmakers?.length) {
          const hasProps = value.event.bookmakers.some((b) =>
            b.markets?.some(
              (m) => markets.includes(m.key) && (m.outcomes?.length ?? 0) > 0,
            ),
          );
          if (hasProps) return value.event;
        }
      } catch {
        // ESPN fallback for MLB — no paid credits
      }
    }
  }

  if (sport === "baseball_mlb" && meta?.homeTeam && meta?.awayTeam) {
    const cacheKey = `eventOdds:espn:${eventId}:${espnOnly ? "espn" : "credits"}`;
    const { value } = await cacheGetOrSet(
      cacheKey,
      async () => {
        const { fetchEspnMlbPropOdds } = await import("./espn-props");
        const event = await fetchEspnMlbPropOdds({
          eventId,
          homeTeam: meta.homeTeam!,
          awayTeam: meta.awayTeam!,
          commenceTime: meta.commenceTime ?? new Date().toISOString(),
        });
        return { event };
      },
      espnOnly ? ESPN_ODDS_CACHE_TTL_MS : ODDS_CACHE_TTL_MS,
    );
    return value.event;
  }

  return null;
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
