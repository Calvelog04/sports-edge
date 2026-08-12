import { promises as fs } from "fs";
import path from "path";
import {
  ODDS_REFRESH_HOURS,
  ODDS_TIMEZONE,
  PROPS_REFRESH_HOUR,
  PROPS_REFRESH_HOURS,
  formatNextOddsRefresh,
  formatNextPropsRefresh,
  getOddsRefreshSlotId,
  getPropsPullSource,
  getPropsRefreshSlotId,
  isInOddsRefreshWindow,
  nextOddsRefreshAt,
  nextPropsRefreshAt,
  partsInTz,
  type PropsPullSource,
} from "./odds-window";

export {
  ODDS_REFRESH_HOURS,
  ODDS_TIMEZONE,
  PROPS_REFRESH_HOUR,
  PROPS_REFRESH_HOURS,
  formatNextOddsRefresh,
  formatNextPropsRefresh,
  getOddsRefreshSlotId,
  getPropsPullSource,
  getPropsRefreshSlotId,
  isInOddsRefreshWindow,
  nextOddsRefreshAt,
  nextPropsRefreshAt,
  partsInTz,
  type PropsPullSource,
};

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "odds-disk-cache.json");

type DiskEntry = {
  slotId: string;
  savedAt: string;
  status: number;
  body: string;
  headers: Record<string, string>;
};

type DiskCacheFile = {
  entries: Record<string, DiskEntry>;
};

let memoryCache: DiskCacheFile = { entries: {} };
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as DiskCacheFile;
    memoryCache = { entries: parsed.entries ?? {} };
  } catch {
    memoryCache = { entries: {} };
  }
}

async function persist(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => undefined);
  const keys = Object.keys(memoryCache.entries);
  if (keys.length > 80) {
    const sorted = keys
      .map((k) => ({ k, t: memoryCache.entries[k]?.savedAt ?? "" }))
      .sort((a, b) => a.t.localeCompare(b.t));
    for (const row of sorted.slice(0, keys.length - 60)) {
      delete memoryCache.entries[row.k];
    }
  }
  await fs
    .writeFile(CACHE_FILE, JSON.stringify(memoryCache, null, 2), "utf8")
    .catch(() => undefined);
}

function cacheKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("apiKey");
    return u.toString();
  } catch {
    return url.replace(/apiKey=[^&]+/i, "apiKey=REDACTED");
  }
}

export async function readOddsDiskCache(url: string): Promise<Response | null> {
  await ensureLoaded();
  const key = cacheKeyFromUrl(url);
  const entry = memoryCache.entries[key];
  if (!entry) return null;
  const headers = new Headers(entry.headers);
  headers.set("x-mintpicks-disk-cache", "1");
  headers.set("x-mintpicks-slot", entry.slotId);
  return new Response(entry.body, { status: entry.status, headers });
}

export async function writeOddsDiskCache(
  url: string,
  res: Response,
  slotId: string,
): Promise<void> {
  await ensureLoaded();
  const key = cacheKeyFromUrl(url);
  const body = await res.clone().text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  memoryCache.entries[key] = {
    slotId,
    savedAt: new Date().toISOString(),
    status: res.status,
    body,
    headers,
  };
  await persist();
}

/**
 * Outside 10am–9pm: no network (serve last disk cache).
 * Inside: network only if this URL was not already pulled in the current hour slot.
 */
export async function shouldNetworkFetchOdds(
  url: string,
  now = new Date(),
): Promise<{ allow: boolean; slotId: string | null; reason: string }> {
  const slotId = getOddsRefreshSlotId(now);
  if (!slotId) {
    return {
      allow: false,
      slotId: null,
      reason: "Outside daily odds window (hourly 10am–10pm local, 12 pulls/day).",
    };
  }
  await ensureLoaded();
  const key = cacheKeyFromUrl(url);
  const entry = memoryCache.entries[key];
  if (entry && entry.slotId === slotId) {
    return {
      allow: false,
      slotId,
      reason: "Already pulled this hour — serving cached odds.",
    };
  }
  return { allow: true, slotId, reason: "Refresh slot open — network pull allowed." };
}

/** Logical cache URL for non-TOA providers (Parlay, SportsGameOdds, etc.). */
export function scheduledOddsCacheUrl(logicalKey: string): string {
  return `mintpicks://odds-slot/${logicalKey.replace(/[^a-zA-Z0-9:_.,|-]/g, "_")}`;
}

/**
 * At most one network pull per logical key per refresh hour (12×/day).
 * Refresh / tab changes reuse disk cache — no extra credits.
 * Returns null when the schedule blocks network and nothing is cached yet.
 */
export async function withScheduledOddsPull<T>(
  logicalKey: string,
  loader: () => Promise<T>,
): Promise<{
  value: T;
  fromCache: boolean;
  network: boolean;
  reason: string;
} | null> {
  const url = scheduledOddsCacheUrl(logicalKey);
  const gate = await shouldNetworkFetchOdds(url);

  if (!gate.allow) {
    const cached = await readOddsDiskCache(url);
    if (cached) {
      const body = (await cached.json()) as T;
      return {
        value: body,
        fromCache: true,
        network: false,
        reason: gate.reason,
      };
    }
    return null;
  }

  const value = await loader();
  const res = new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  await writeOddsDiskCache(url, res, gate.slotId!);
  return {
    value,
    fromCache: false,
    network: true,
    reason: gate.reason,
  };
}

export function oddsScheduleSummary(now = new Date()): {
  timezone: string;
  inWindow: boolean;
  slotId: string | null;
  hours: number[];
  message: string;
} {
  return {
    timezone: ODDS_TIMEZONE,
    inWindow: isInOddsRefreshWindow(now),
    slotId: getOddsRefreshSlotId(now),
    hours: [...ODDS_REFRESH_HOURS],
    message: formatNextOddsRefresh(now),
  };
}

export async function shouldNetworkFetchProps(
  url: string,
  now = new Date(),
): Promise<{
  allow: boolean;
  slotId: string | null;
  source: PropsPullSource | null;
  reason: string;
}> {
  const slotId = getPropsRefreshSlotId(now);
  const source = getPropsPullSource(now);
  if (!slotId || !source) {
    return {
      allow: false,
      slotId: null,
      source: null,
      reason: "Props auto-pulls at noon (credits) and 4pm (ESPN) local — before today's window.",
    };
  }
  await ensureLoaded();
  const key = cacheKeyFromUrl(url);
  const entry = memoryCache.entries[key];
  if (entry && entry.slotId === slotId) {
    // Empty pulls shouldn't lock the slot — markets often appear later.
    try {
      const body = JSON.parse(entry.body) as {
        mode?: string;
        eventsScanned?: number;
        opportunities?: unknown[];
      };
      const empty =
        body.mode === "unavailable" &&
        (body.eventsScanned ?? 0) === 0 &&
        (body.opportunities?.length ?? 0) === 0;
      if (empty) {
        return {
          allow: true,
          slotId,
          source,
          reason:
            source === "espn"
              ? "Cached ESPN props board was empty — retrying pull."
              : "Cached noon props board was empty — retrying pull.",
        };
      }
    } catch {
      // treat as filled cache
    }
    return {
      allow: false,
      slotId,
      source,
      reason:
        source === "espn"
          ? "Already ran 4pm ESPN props refresh — serving cached board."
          : "Already ran noon credits props pull — serving cached board.",
    };
  }
  return {
    allow: true,
    slotId,
    source,
    reason:
      source === "espn"
        ? "4pm ESPN props refresh window open — network pull allowed."
        : "Noon credits props window open — network pull allowed.",
  };
}

/**
 * Props network pulls: noon (paid credits) and 4pm (ESPN) local.
 * Between slots / overnight, serve disk cache.
 */
export async function withScheduledPropsPull<T>(
  logicalKey: string,
  loader: (source: PropsPullSource) => Promise<T>,
): Promise<{
  value: T;
  fromCache: boolean;
  network: boolean;
  reason: string;
  source: PropsPullSource | null;
} | null> {
  const url = scheduledOddsCacheUrl(`props-daily:${logicalKey}`);
  const gate = await shouldNetworkFetchProps(url);

  if (!gate.allow) {
    const cached = await readOddsDiskCache(url);
    if (cached) {
      const body = (await cached.json()) as T;
      return {
        value: body,
        fromCache: true,
        network: false,
        reason: gate.reason,
        source: gate.source,
      };
    }
    return null;
  }

  const value = await loader(gate.source!);
  const res = new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  await writeOddsDiskCache(url, res, gate.slotId!);
  return {
    value,
    fromCache: false,
    network: true,
    reason: gate.reason,
    source: gate.source,
  };
}

export function propsScheduleSummary(now = new Date()): {
  timezone: string;
  slotId: string | null;
  hours: number[];
  source: PropsPullSource | null;
  message: string;
} {
  return {
    timezone: ODDS_TIMEZONE,
    slotId: getPropsRefreshSlotId(now),
    hours: [...PROPS_REFRESH_HOURS],
    source: getPropsPullSource(now),
    message: formatNextPropsRefresh(now),
  };
}
