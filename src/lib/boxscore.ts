import type { PickStatus } from "./picks";
import { GAME_DATE_TZ, gameDateKey } from "./pick-identity";

export interface BoxBatterStats {
  name: string;
  hits: number;
  homeRuns: number;
  atBats: number;
  teamName: string;
}

export interface MlbBoxScore {
  gamePk: number;
  status: string;
  completed: boolean;
  officialDate?: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  /** Combined runs scored in the 1st inning (both clubs). Null if 1st not complete. */
  firstInningRuns: number | null;
  batters: BoxBatterStats[];
  source: "mlb-statsapi";
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aTokens = na.split(" ").filter((t) => t.length > 1);
  const bTokens = nb.split(" ").filter((t) => t.length > 1);
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  // last-name match (Judge ↔ Aaron Judge)
  const aLast = aTokens[aTokens.length - 1];
  const bLast = bTokens[bTokens.length - 1];
  if (aLast === bLast && aLast.length >= 3) {
    if (aTokens.length === 1 || bTokens.length === 1) return true;
    const overlap = bTokens.filter((t) => aTokens.includes(t)).length;
    return overlap >= 2 || (overlap >= 1 && aLast.length >= 5);
  }
  const aSet = new Set(aTokens);
  const overlap = bTokens.filter((t) => aSet.has(t)).length;
  return overlap >= 2;
}

function dateKeysAround(iso: string): string[] {
  // MLB Stats API schedule is keyed by the game's calendar date.
  // Use only the bet's listed slate day (CT) — never yesterday-first.
  const center = gameDateKey(iso, GAME_DATE_TZ);
  return center ? [center] : [];
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface ScheduleGame {
  gamePk: number;
  officialDate?: string;
  status?: { detailedState?: string; abstractGameState?: string };
  teams?: {
    home?: { team?: { name?: string }; score?: number };
    away?: { team?: { name?: string }; score?: number };
  };
}

function pickScheduleGame(
  games: ScheduleGame[],
  homeTeam: string,
  awayTeam: string,
  requiredDate?: string,
): ScheduleGame | null {
  const pool = requiredDate
    ? games.filter((g) => !g.officialDate || g.officialDate === requiredDate)
    : games;
  // Require both clubs — never match on a single team (series / wrong game risk).
  return (
    pool.find(
      (g) =>
        namesMatch(String(g.teams?.home?.team?.name ?? ""), homeTeam) &&
        namesMatch(String(g.teams?.away?.team?.name ?? ""), awayTeam),
    ) ?? null
  );
}

function parseBatters(
  side: Record<string, unknown>,
  teamName: string,
): BoxBatterStats[] {
  const players = (side.players ?? {}) as Record<string, Record<string, unknown>>;
  const batterIds = (side.batters as number[] | undefined) ?? [];
  const out: BoxBatterStats[] = [];

  const ids =
    batterIds.length > 0
      ? batterIds.map((id) => `ID${id}`)
      : Object.keys(players);

  for (const key of ids) {
    const row = players[key] ?? players[key.replace(/^ID/, "")] ?? null;
    if (!row) continue;
    const person = row.person as { fullName?: string } | undefined;
    const batting = (row.stats as { batting?: Record<string, unknown> } | undefined)?.batting;
    if (!person?.fullName || !batting) continue;
    const hits = Number(batting.hits);
    const homeRuns = Number(batting.homeRuns);
    const atBats = Number(batting.atBats);
    if (!Number.isFinite(hits) && !Number.isFinite(homeRuns)) continue;
    out.push({
      name: person.fullName,
      hits: Number.isFinite(hits) ? hits : 0,
      homeRuns: Number.isFinite(homeRuns) ? homeRuns : 0,
      atBats: Number.isFinite(atBats) ? atBats : 0,
      teamName,
    });
  }
  return out;
}

export async function fetchMlbBoxScore(opts: {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}): Promise<MlbBoxScore | null> {
  const requiredDate = gameDateKey(opts.commenceTime, GAME_DATE_TZ);
  if (!requiredDate) return null;

  const dates = dateKeysAround(opts.commenceTime);
  let game: ScheduleGame | null = null;

  for (const date of dates) {
    const sched = (await fetchJson(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`,
    )) as { dates?: Array<{ games?: ScheduleGame[] }> } | null;
    const games = sched?.dates?.[0]?.games ?? [];
    game = pickScheduleGame(games, opts.homeTeam, opts.awayTeam, requiredDate);
    if (game) break;
  }

  if (!game?.gamePk) return null;
  // Hard reject if Stats API officialDate disagrees with the bet's listed day.
  if (game.officialDate && game.officialDate !== requiredDate) return null;

  const feed = (await fetchJson(
    `https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`,
  )) as {
    gameData?: {
      status?: { detailedState?: string; abstractGameState?: string };
      teams?: { home?: { name?: string }; away?: { name?: string } };
    };
    liveData?: {
      linescore?: {
        teams?: { home?: { runs?: number }; away?: { runs?: number } };
        innings?: Array<{
          num?: number;
          home?: { runs?: number | null };
          away?: { runs?: number | null };
        }>;
      };
      boxscore?: {
        teams?: {
          home?: Record<string, unknown>;
          away?: Record<string, unknown>;
        };
      };
    };
  } | null;

  if (!feed?.liveData) return null;

  const homeName =
    feed.gameData?.teams?.home?.name ??
    String(game.teams?.home?.team?.name ?? opts.homeTeam);
  const awayName =
    feed.gameData?.teams?.away?.name ??
    String(game.teams?.away?.team?.name ?? opts.awayTeam);

  const homeBox = feed.liveData.boxscore?.teams?.home ?? {};
  const awayBox = feed.liveData.boxscore?.teams?.away ?? {};
  const batters = [
    ...parseBatters(awayBox, awayName),
    ...parseBatters(homeBox, homeName),
  ];

  const inns = feed.liveData.linescore?.innings ?? [];
  const first = inns.find((i) => i.num === 1) ?? inns[0];
  let firstInningRuns: number | null = null;
  if (first && first.away?.runs != null && first.home?.runs != null) {
    firstInningRuns = Number(first.away.runs) + Number(first.home.runs);
  } else if (inns.length >= 2 && first) {
    // 2nd inning started ⇒ 1st is complete even if a side scored 0
    firstInningRuns = Number(first.away?.runs ?? 0) + Number(first.home?.runs ?? 0);
  }

  const status =
    feed.gameData?.status?.detailedState ??
    game.status?.detailedState ??
    "Unknown";
  const completed =
    /final/i.test(status) ||
    feed.gameData?.status?.abstractGameState === "Final" ||
    game.status?.abstractGameState === "Final";

  const homeScore = Number(
    feed.liveData.linescore?.teams?.home?.runs ?? game.teams?.home?.score ?? 0,
  );
  const awayScore = Number(
    feed.liveData.linescore?.teams?.away?.runs ?? game.teams?.away?.score ?? 0,
  );

  return {
    gamePk: game.gamePk,
    status,
    completed,
    officialDate: game.officialDate ?? requiredDate,
    homeTeam: homeName,
    awayTeam: awayName,
    homeScore: Number.isFinite(homeScore) ? homeScore : 0,
    awayScore: Number.isFinite(awayScore) ? awayScore : 0,
    firstInningRuns: Number.isFinite(firstInningRuns as number)
      ? (firstInningRuns as number)
      : null,
    batters,
    source: "mlb-statsapi",
  };
}

export function findBatter(
  box: MlbBoxScore,
  playerName: string,
): BoxBatterStats | null {
  const exact = box.batters.find((b) => namesMatch(b.name, playerName));
  if (exact) return exact;
  return null;
}

function ouStatus(value: number, line: number, isOver: boolean): PickStatus {
  if (Math.abs(value - line) < 1e-9) return "push";
  if (isOver) return value > line ? "won" : "lost";
  return value < line ? "won" : "lost";
}

export function settlePropAgainstBox(
  pick: {
    market: string;
    selection: string;
    line?: number;
    player?: string;
    homeTeam: string;
    awayTeam: string;
    commenceTime?: string;
  },
  box: MlbBoxScore,
): { status: PickStatus; homeScore: number; awayScore: number; note: string } | null {
  const day = gameDateKey(pick.commenceTime, GAME_DATE_TZ);
  if (day && box.officialDate && box.officialDate !== day) {
    return null;
  }
  const settledAtNote = `box ${box.gamePk}${day ? ` · day ${day}` : ""}`;
  const isOver = /\bover\b/i.test(pick.selection) || /^over$/i.test(pick.selection.trim());
  const isUnder =
    /\bunder\b/i.test(pick.selection) || /^under$/i.test(pick.selection.trim());

  if (pick.market === "totals_1st_1_innings") {
    if (box.firstInningRuns == null) return null;
    // Prefer completed games; allow early settle once 1st is in the book
    const line = pick.line ?? 0.5;
    const sideOver = isOver || (!isUnder && /over/i.test(pick.selection));
    const status = ouStatus(box.firstInningRuns, line, sideOver);
    return {
      status,
      homeScore: box.homeScore,
      awayScore: box.awayScore,
      note: `1st inning runs ${box.firstInningRuns} vs ${sideOver ? "Over" : "Under"} ${line} (${settledAtNote}) → ${status}`,
    };
  }

  if (pick.market === "batter_hits" || pick.market === "batter_home_runs") {
    if (!box.completed && box.batters.length === 0) return null;
    // Wait for final so incomplete ABs don't false-grade Unders
    if (!box.completed) return null;

    const player =
      pick.player ||
      pick.selection.split("·")[0]?.trim() ||
      pick.selection.replace(/\s*[·-]\s*(Over|Under).*$/i, "").trim();
    if (!player) return null;

    const batter = findBatter(box, player);
    if (!batter) {
      return {
        status: "void",
        homeScore: box.homeScore,
        awayScore: box.awayScore,
        note: `No box-score line for ${player} (${settledAtNote})`,
      };
    }

    const line = pick.line ?? 0.5;
    const value = pick.market === "batter_hits" ? batter.hits : batter.homeRuns;
    const sideOver = isOver || (!isUnder && /over/i.test(pick.selection));
    const status = ouStatus(value, line, sideOver);
    const statLabel = pick.market === "batter_hits" ? "H" : "HR";
    return {
      status,
      homeScore: box.homeScore,
      awayScore: box.awayScore,
      note: `${batter.name} ${statLabel} ${value} (AB ${batter.atBats}) vs ${sideOver ? "Over" : "Under"} ${line} · ${box.awayTeam} ${box.awayScore}@${box.homeTeam} ${box.homeScore} (${settledAtNote}) → ${status}`,
    };
  }

  return null;
}
