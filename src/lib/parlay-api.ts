import type { OddsEvent, SportKey } from "./types";

const PARLAY_BASE = "https://parlay-api.com/v1";

export function hasParlayApiKey(): boolean {
  return Boolean(
    process.env.PARLAY_API_KEY?.trim() ||
      process.env.PARLAYAPI_KEY?.trim() ||
      process.env.PARLEY_API_KEY?.trim(),
  );
}

function parlayApiKey(): string | null {
  const key =
    process.env.PARLAY_API_KEY?.trim() ||
    process.env.PARLAYAPI_KEY?.trim() ||
    process.env.PARLEY_API_KEY?.trim() ||
    "";
  return key || null;
}

function remainingFrom(headers: Headers): number | null {
  const v = headers.get("x-requests-remaining");
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function parlayFetch(pathAndQuery: string): Promise<{
  ok: boolean;
  status: number;
  json: unknown;
  remaining: number | null;
  errorText: string;
}> {
  const key = parlayApiKey();
  if (!key) {
    return {
      ok: false,
      status: 401,
      json: null,
      remaining: null,
      errorText: "No PARLAY_API_KEY configured",
    };
  }

  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${PARLAY_BASE}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-API-Key": key,
    },
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    json,
    remaining: remainingFrom(res.headers),
    errorText: text.slice(0, 240),
  };
}

function asEvents(json: unknown): OddsEvent[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (e): e is OddsEvent =>
      Boolean(e) &&
      typeof e === "object" &&
      Array.isArray((e as OddsEvent).bookmakers) &&
      (e as OddsEvent).bookmakers.length > 0,
  );
}

function mergeById(a: OddsEvent[], b: OddsEvent[]): OddsEvent[] {
  const map = new Map<string, OddsEvent>();
  for (const ev of [...a, ...b]) {
    const prev = map.get(ev.id);
    if (!prev || ev.bookmakers.length > prev.bookmakers.length) {
      map.set(ev.id, ev);
    }
  }
  return [...map.values()];
}

/**
 * ParlayAPI is Odds-API-compatible. Free/pre-game odds omit in-play games,
 * so we merge a live=true pull when possible.
 */
export async function fetchParlayGameLines(
  sport: SportKey,
  markets: string[] = ["h2h", "spreads", "totals"],
): Promise<{
  events: OddsEvent[];
  warning: string;
  remaining: number | null;
}> {
  const params = new URLSearchParams({
    regions: "us",
    markets: markets.join(","),
    oddsFormat: "american",
    bookmakers: "fanduel,draftkings,betmgm,caesars,betrivers",
  });

  const path = `/sports/${sport}/odds?${params.toString()}`;
  const upcoming = await parlayFetch(path);
  if (!upcoming.ok) {
    throw new Error(
      `ParlayAPI error (${upcoming.status}): ${upcoming.errorText}`,
    );
  }

  let liveEvents: OddsEvent[] = [];
  let remaining = upcoming.remaining;
  try {
    const liveParams = new URLSearchParams(params);
    liveParams.set("live", "true");
    const live = await parlayFetch(`/sports/${sport}/odds?${liveParams.toString()}`);
    if (live.ok) {
      liveEvents = asEvents(live.json);
      if (live.remaining != null) remaining = live.remaining;
    }
  } catch {
    // upcoming-only is still useful
  }

  const { phaseFromCommence } = await import("./timing");
  const events = mergeById(asEvents(upcoming.json), liveEvents)
    .map((e) => ({
      ...e,
      gamePhase: e.gamePhase ?? phaseFromCommence(e.commence_time),
    }))
    .filter((e) => e.gamePhase !== "final");

  const liveCount = events.filter((e) => e.gamePhase === "in_progress").length;
  const rem =
    remaining != null ? ` · ${remaining} requests left` : "";

  return {
    events,
    remaining,
    warning:
      events.length === 0
        ? `ParlayAPI returned no ${sport} lines${rem}.`
        : `Using ParlayAPI (${events.length} games · ${liveCount} in-play${rem}).`,
  };
}

export async function fetchParlaySportEvents(sport: SportKey): Promise<{
  events: Array<{
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
  }>;
  warning?: string;
}> {
  const res = await parlayFetch(`/sports/${sport}/events`);
  if (!res.ok) {
    throw new Error(`ParlayAPI events error (${res.status}): ${res.errorText}`);
  }
  const list = Array.isArray(res.json) ? res.json : [];
  return {
    events: list as Array<{
      id: string;
      sport_key: string;
      sport_title: string;
      commence_time: string;
      home_team: string;
      away_team: string;
    }>,
    warning:
      res.remaining != null
        ? `ParlayAPI events · ${res.remaining} requests left.`
        : undefined,
  };
}

export async function fetchParlayEventOdds(
  sport: SportKey,
  eventId: string,
  markets: string[],
): Promise<OddsEvent | null> {
  const params = new URLSearchParams({
    regions: "us",
    markets: markets.join(","),
    oddsFormat: "american",
    bookmakers: "fanduel,draftkings,betmgm,caesars,betrivers",
  });
  const res = await parlayFetch(
    `/sports/${sport}/events/${eventId}/odds?${params.toString()}`,
  );
  if (!res.ok) {
    throw new Error(`ParlayAPI event odds error (${res.status}): ${res.errorText}`);
  }
  if (res.json && typeof res.json === "object" && !Array.isArray(res.json)) {
    return res.json as OddsEvent;
  }
  return null;
}
