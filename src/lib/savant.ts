import { promises as fs } from "fs";
import path from "path";
import type { SavantMatchupContext, SavantTeamStatcast } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "savant-league.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

interface CachePayload {
  fetchedAt: string;
  season: number;
  source: string;
  hitting: SavantTeamStatcast[];
  pitching: SavantTeamStatcast[];
}

let memoryCache: CachePayload | null = null;
let inflight: Promise<CachePayload | null> | null = null;

function seasonNow(d = new Date()): number {
  // MLB season year flips around late March
  return d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.trim().replace(/^(\.)/, "0$1");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function rank01(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  // Savant percent ranks are 1–100 (or 0–1 in unrounded fields)
  if (n <= 1) return Math.max(0, Math.min(1, n));
  return Math.max(0, Math.min(1, n / 100));
}

function extractJsArray(html: string, marker: string): unknown[] {
  const idx = html.indexOf(marker);
  if (idx < 0) return [];
  const start = html.indexOf("[", idx);
  if (start < 0) return [];
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as unknown[];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function mapTeamRow(row: Record<string, unknown>): SavantTeamStatcast | null {
  const teamName = String(row.team_name ?? "").trim();
  const abbrev = String(row.team_abbrev ?? row.team_code ?? "").trim().toUpperCase();
  if (!teamName && !abbrev) return null;

  return {
    teamId: String(row.team_id ?? row.player_id ?? ""),
    teamName,
    teamAbbrev: abbrev,
    league: String(row.league ?? ""),
    pa: num(row.pa) ?? undefined,
    ba: num(row.ba),
    obp: num(row.obp),
    slg: num(row.slg),
    woba: num(row.woba),
    xwoba: num(row.xwoba),
    xba: num(row.xba),
    xslg: num(row.xslg),
    barrelPct: num(row.barrel_batted_rate),
    hardHitPct: num(row.hard_hit_percent),
    exitVelo: num(row.exit_velocity_avg),
    launchAngle: num(row.launch_angle_avg),
    kPct: num(row.k_percent),
    bbPct: num(row.bb_percent),
    whiffPct: num(row.whiff_percent),
    rankXwoba: rank01(row.percent_rank_xwoba),
    rankWoba: rank01(row.percent_rank_woba),
    rankBarrel: rank01(row.percent_rank_barrel_batted_rate),
    rankHardHit: rank01(row.percent_rank_hard_hit_percent),
    rankExitVelo: rank01(row.percent_rank_exit_velocity_avg),
  };
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/d-backs/g, "diamondbacks")
    .replace(/athletic'?s/g, "athletics")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES: Record<string, string[]> = {
  diamondbacks: ["arizona diamondbacks", "dbacks", "ari"],
  athletics: ["oakland athletics", "as", "oak", "ath"],
  guardians: ["cleveland guardians", "cleveland indians", "cle"],
  rays: ["tampa bay rays", "tampa bay devil rays", "tb"],
  redsox: ["boston red sox", "bos"],
  whitesox: ["chicago white sox", "cws", "chw"],
  bluesjays: ["toronto blue jays", "tor"],
  yankees: ["new york yankees", "nyy"],
  mets: ["new york mets", "nym"],
  dodgers: ["los angeles dodgers", "lad"],
  angels: ["los angeles angels", "laa", "anaheim angels"],
  padres: ["san diego padres", "sd"],
  giants: ["san francisco giants", "sf"],
  mariners: ["seattle mariners", "sea"],
  rangers: ["texas rangers", "tex"],
  astros: ["houston astros", "hou"],
  braves: ["atlanta braves", "atl"],
  phillies: ["philadelphia phillies", "phi"],
  nationals: ["washington nationals", "wsh", "was"],
  marlins: ["miami marlins", "mia", "florida marlins"],
  cubs: ["chicago cubs", "chc"],
  brewers: ["milwaukee brewers", "mil"],
  cardinals: ["st louis cardinals", "stl"],
  pirates: ["pittsburgh pirates", "pit"],
  reds: ["cincinnati reds", "cin"],
  rockies: ["colorado rockies", "col"],
  twins: ["minnesota twins", "min"],
  tigers: ["detroit tigers", "det"],
  royals: ["kansas city royals", "kc"],
  orioles: ["baltimore orioles", "bal"],
};

function teamKey(name: string): string {
  return normalizeName(name).replace(/\s+/g, "");
}

export function findSavantTeam(
  query: string,
  teams: SavantTeamStatcast[],
): SavantTeamStatcast | null {
  const nq = normalizeName(query);
  const qKey = teamKey(query);

  for (const t of teams) {
    const tn = normalizeName(t.teamName);
    const ab = normalizeName(t.teamAbbrev);
    if (nq === tn || nq.endsWith(tn) || tn === qKey) return t;
    if (nq === ab || nq.includes(` ${ab}`) || ab === qKey) return t;
  }

  for (const [nick, aliases] of Object.entries(ALIASES)) {
    const hit =
      qKey.includes(nick) ||
      aliases.some((a) => nq === a || nq.includes(a) || teamKey(a) === qKey);
    if (!hit) continue;
    const found = teams.find((t) => teamKey(t.teamName) === nick || teamKey(t.teamName).includes(nick));
    if (found) return found;
  }

  // last-token nickname: "New York Yankees" -> "yankees"
  const last = nq.split(" ").pop() ?? "";
  if (last.length >= 4) {
    const found = teams.find((t) => normalizeName(t.teamName) === last);
    if (found) return found;
  }

  return null;
}

function sidePower(hit: SavantTeamStatcast | null, pit: SavantTeamStatcast | null): number | null {
  if (!hit && !pit) return null;
  const off =
    hit?.rankXwoba ??
    (hit?.xwoba != null ? clamp01((hit.xwoba - 0.28) / 0.08) : null) ??
    0.5;
  const pitch =
    pit?.rankXwoba ??
    (pit?.xwoba != null ? clamp01((0.34 - pit.xwoba) / 0.08) : null) ??
    0.5;
  // For pitching rows, Savant percent_rank_xwoba is oriented so higher = better staff
  const barrel = hit?.rankBarrel ?? 0.5;
  const hard = hit?.rankHardHit ?? 0.5;
  return clamp01(0.4 * off + 0.35 * pitch + 0.15 * barrel + 0.1 * hard);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function buildSavantMatchup(
  homeTeam: string,
  awayTeam: string,
  hitting: SavantTeamStatcast[],
  pitching: SavantTeamStatcast[],
): SavantMatchupContext | null {
  const homeHit = findSavantTeam(homeTeam, hitting);
  const awayHit = findSavantTeam(awayTeam, hitting);
  const homePit = findSavantTeam(homeTeam, pitching);
  const awayPit = findSavantTeam(awayTeam, pitching);

  if (!homeHit && !awayHit && !homePit && !awayPit) return null;

  const homePower = sidePower(homeHit, homePit) ?? 0.5;
  const awayPower = sidePower(awayHit, awayPit) ?? 0.5;
  const homeWinProb = clamp01(homePower / (homePower + awayPower || 1));
  // Soften extremes
  const softened = 0.5 + (homeWinProb - 0.5) * 0.85;
  const homeWinLean = Math.max(0.34, Math.min(0.66, softened));

  const offenseEnv =
    ((homeHit?.rankXwoba ?? 0.5) + (awayHit?.rankXwoba ?? 0.5)) / 2;
  const pitchEnv =
    ((homePit?.rankXwoba ?? 0.5) + (awayPit?.rankXwoba ?? 0.5)) / 2;
  // High offense ranks + weak pitching ranks (low) => overs
  const totalOverLean = Math.max(-0.08, Math.min(0.08, (offenseEnv - pitchEnv) * 0.12));

  return {
    season: seasonNow(),
    sourceUrl: `https://baseballsavant.mlb.com/league?season=${seasonNow()}`,
    home: { hitting: homeHit, pitching: homePit },
    away: { hitting: awayHit, pitching: awayPit },
    homeWinLean,
    totalOverLean,
  };
}

async function readDiskCache(): Promise<CachePayload | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as CachePayload;
  } catch {
    return null;
  }
}

async function writeDiskCache(payload: CachePayload): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function isFresh(payload: CachePayload): boolean {
  const t = Date.parse(payload.fetchedAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < CACHE_TTL_MS && payload.hitting.length > 0;
}

async function fetchLeaguePage(season: number): Promise<CachePayload | null> {
  const url = `https://baseballsavant.mlb.com/league?season=${season}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": UA,
      Referer: "https://baseballsavant.mlb.com/",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  if (!html || html.length < 1000) return null;

  const hitRows = extractJsArray(html, "statcastHitting:");
  const pitRows = extractJsArray(html, "statcastPitching:");

  const hitting = hitRows
    .map((r) => mapTeamRow(r as Record<string, unknown>))
    .filter((t): t is SavantTeamStatcast => Boolean(t));
  const pitching = pitRows
    .map((r) => mapTeamRow(r as Record<string, unknown>))
    .filter((t): t is SavantTeamStatcast => Boolean(t));

  if (hitting.length < 20 || pitching.length < 20) return null;

  return {
    fetchedAt: new Date().toISOString(),
    season,
    source: url,
    hitting,
    pitching,
  };
}

export async function loadSavantLeague(force = false): Promise<CachePayload | null> {
  if (!force && memoryCache && isFresh(memoryCache)) return memoryCache;

  if (!force) {
    const disk = await readDiskCache();
    if (disk && isFresh(disk)) {
      memoryCache = disk;
      return disk;
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const season = seasonNow();
    try {
      let payload = await fetchLeaguePage(season);
      if (!payload && season === new Date().getFullYear()) {
        payload = await fetchLeaguePage(season - 1);
      }
      if (payload) {
        memoryCache = payload;
        await writeDiskCache(payload).catch(() => undefined);
        return payload;
      }
      const disk = await readDiskCache();
      if (disk) {
        memoryCache = disk;
        return disk;
      }
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function getSavantMatchup(
  homeTeam: string,
  awayTeam: string,
): Promise<SavantMatchupContext | null> {
  const league = await loadSavantLeague();
  if (!league) return null;
  const matchup = buildSavantMatchup(homeTeam, awayTeam, league.hitting, league.pitching);
  if (!matchup) return null;
  return { ...matchup, season: league.season, sourceUrl: league.source };
}

export function savantSummaryLine(ctx: SavantMatchupContext | null | undefined): string | null {
  if (!ctx) return null;
  const h = ctx.home.hitting;
  const a = ctx.away.hitting;
  const hp = ctx.home.pitching;
  const ap = ctx.away.pitching;
  const bits: string[] = [
    `Savant lean home ${(ctx.homeWinLean * 100).toFixed(1)}%`,
  ];
  if (h?.xwoba != null && a?.xwoba != null) {
    bits.push(
      `xwOBA ${h.teamAbbrev || "H"} ${h.xwoba.toFixed(3)} vs ${a.teamAbbrev || "A"} ${a.xwoba.toFixed(3)}`,
    );
  }
  if (hp?.xwoba != null && ap?.xwoba != null) {
    bits.push(
      `staff xwOBA allowed ${hp.teamAbbrev || "H"} ${hp.xwoba.toFixed(3)} / ${ap.teamAbbrev || "A"} ${ap.xwoba.toFixed(3)}`,
    );
  }
  if (h?.barrelPct != null && a?.barrelPct != null) {
    bits.push(`barrel% ${h.barrelPct.toFixed(1)} / ${a.barrelPct.toFixed(1)}`);
  }
  return bits.join(" · ");
}
