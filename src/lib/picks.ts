import { promises as fs } from "fs";
import path from "path";
import { fetchMlbBoxScore, settlePropAgainstBox } from "./boxscore";
import { isPropMarket } from "./types";
import type { MarketKey, SportKey } from "./types";

export type PickStatus = "open" | "won" | "lost" | "push" | "void";

export interface StoredPick {
  id: string;
  createdAt: string;
  eventId: string;
  sport: SportKey | string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  market: MarketKey;
  selection: string;
  /** Player name for batter props */
  player?: string;
  line?: number;
  price: number;
  /** Opening American price for CLV (defaults to price). */
  openPrice?: number;
  book: string;
  modelProb: number;
  edgePct: number;
  status: PickStatus;
  result?: {
    settledAt: string;
    homeScore: number;
    awayScore: number;
    note: string;
  };
}

export interface CreatePickInput {
  eventId: string;
  sport: string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  market: MarketKey;
  selection: string;
  player?: string;
  line?: number;
  price: number;
  book: string;
  modelProb: number;
  edgePct: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const PICKS_FILE = path.join(DATA_DIR, "picks.json");

async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(PICKS_FILE);
  } catch {
    await fs.writeFile(PICKS_FILE, "[]", "utf8");
  }
}

export async function readPicks(): Promise<StoredPick[]> {
  await ensureStore();
  const raw = await fs.readFile(PICKS_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw) as StoredPick[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePicks(picks: StoredPick[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(PICKS_FILE, JSON.stringify(picks, null, 2), "utf8");
}

function normalizeOuSelection(selection: string): string {
  if (/\bunder\b/i.test(selection) || /^under$/i.test(selection.trim())) return "Under";
  if (/\bover\b/i.test(selection) || /^over$/i.test(selection.trim())) return "Over";
  return selection;
}

function inferPlayer(input: CreatePickInput): string | undefined {
  if (input.player?.trim()) return input.player.trim();
  if (!isPropMarket(String(input.market))) return undefined;
  if (input.market === "totals_1st_1_innings") return undefined;
  const fromSelection = input.selection.split("·")[0]?.trim();
  if (fromSelection && !/^(over|under)$/i.test(fromSelection)) return fromSelection;
  return undefined;
}

export async function addPick(input: CreatePickInput): Promise<StoredPick> {
  const picks = await readPicks();
  const player = inferPlayer(input);
  const normalizedSelection = isPropMarket(String(input.market))
    ? normalizeOuSelection(input.selection)
    : input.selection;

  const dup = picks.find(
    (p) =>
      p.eventId === input.eventId &&
      p.market === input.market &&
      p.selection === normalizedSelection &&
      (p.player ?? "") === (player ?? "") &&
      p.line === input.line &&
      p.status === "open",
  );
  if (dup) return dup;

  const pick: StoredPick = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    eventId: input.eventId,
    sport: input.sport,
    sportTitle: input.sportTitle,
    commenceTime: input.commenceTime,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    market: input.market,
    selection: normalizedSelection,
    player,
    line: input.line,
    price: input.price,
    openPrice: input.price,
    book: input.book,
    modelProb: input.modelProb,
    edgePct: input.edgePct,
    status: "open",
  };
  picks.unshift(pick);
  await writePicks(picks);
  return pick;
}

export async function deletePick(id: string): Promise<boolean> {
  const picks = await readPicks();
  const next = picks.filter((p) => p.id !== id);
  if (next.length === picks.length) return false;
  await writePicks(next);
  return true;
}

interface ScoreEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aTokens = new Set(na.split(" "));
  const overlap = nb.split(" ").filter((t) => aTokens.has(t) && t.length > 2).length;
  return overlap >= 2;
}

function scoreFor(event: ScoreEvent, teamName: string): number | null {
  const row = event.scores?.find((s) => namesMatch(s.name, teamName));
  if (!row) return null;
  const n = Number(row.score);
  return Number.isFinite(n) ? n : null;
}

function settleAgainstScores(
  pick: StoredPick,
  event: ScoreEvent,
): (StoredPick["result"] & { status: PickStatus }) | null {
  if (!event.completed || !event.scores?.length) return null;
  if (isPropMarket(String(pick.market))) return null;

  const homeScore = scoreFor(event, pick.homeTeam) ?? scoreFor(event, event.home_team);
  const awayScore = scoreFor(event, pick.awayTeam) ?? scoreFor(event, event.away_team);
  if (homeScore == null || awayScore == null) return null;

  const settledAt = new Date().toISOString();
  const total = homeScore + awayScore;

  if (pick.market === "h2h") {
    if (homeScore === awayScore) {
      return {
        status: "push",
        settledAt,
        homeScore,
        awayScore,
        note: `Final ${awayScore}-${homeScore} (tie)`,
      };
    }
    const winner = homeScore > awayScore ? pick.homeTeam : pick.awayTeam;
    const won = namesMatch(pick.selection, winner);
    return {
      status: won ? "won" : "lost",
      settledAt,
      homeScore,
      awayScore,
      note: `Final ${pick.awayTeam} ${awayScore} @ ${pick.homeTeam} ${homeScore}`,
    };
  }

  if (pick.market === "spreads") {
    const line = pick.line ?? 0;
    const isHome = namesMatch(pick.selection, pick.homeTeam);
    const pickedScore = isHome ? homeScore : awayScore;
    const oppScore = isHome ? awayScore : homeScore;
    const adjusted = pickedScore + line;
    let status: PickStatus;
    if (Math.abs(adjusted - oppScore) < 1e-9) status = "push";
    else status = adjusted > oppScore ? "won" : "lost";
    return {
      status,
      settledAt,
      homeScore,
      awayScore,
      note: `Final ${awayScore}-${homeScore} · ${pick.selection} ${line > 0 ? "+" : ""}${line} → ${status}`,
    };
  }

  if (pick.market === "totals") {
    const line = pick.line ?? 0;
    const isOver = /^over$/i.test(pick.selection);
    let status: PickStatus;
    if (Math.abs(total - line) < 1e-9) status = "push";
    else if (isOver) status = total > line ? "won" : "lost";
    else status = total < line ? "won" : "lost";
    return {
      status,
      settledAt,
      homeScore,
      awayScore,
      note: `Final total ${total} vs ${pick.selection} ${line} → ${status}`,
    };
  }

  return null;
}

function matchScoreEvent(pick: StoredPick, events: ScoreEvent[]): ScoreEvent | null {
  const byId = events.find((e) => e.id === pick.eventId);
  if (byId) return byId;
  return (
    events.find(
      (e) =>
        namesMatch(e.home_team, pick.homeTeam) && namesMatch(e.away_team, pick.awayTeam),
    ) ?? null
  );
}

async function fetchScoresForSport(sport: string, daysFrom = 3): Promise<ScoreEvent[]> {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) return [];
  const params = new URLSearchParams({
    apiKey: key,
    daysFrom: String(daysFrom),
  });
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores?${params}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const { recordOddsQuota } = await import("./odds-quota");
  await recordOddsQuota(res.headers);
  return (await res.json()) as ScoreEvent[];
}

export async function settleOpenPicks(): Promise<{
  picks: StoredPick[];
  settled: number;
  stillOpen: number;
  learned: number;
  modelUpdatedAt: string | null;
}> {
  const picks = await readPicks();
  const open = picks.filter((p) => p.status === "open");
  if (open.length === 0) {
    const { learnIfNeeded } = await import("./learn");
    const learned = await learnIfNeeded(picks);
    return {
      picks,
      settled: 0,
      stillOpen: 0,
      learned: learned.learned,
      modelUpdatedAt: learned.state.updatedAt,
    };
  }

  const sports = [...new Set(open.map((p) => String(p.sport)))];
  const scoresBySport = new Map<string, ScoreEvent[]>();
  await Promise.all(
    sports.map(async (sport) => {
      scoresBySport.set(sport, await fetchScoresForSport(sport, 3));
    }),
  );

  // Box-score cache keyed by matchup+date for MLB props
  const boxCache = new Map<string, Awaited<ReturnType<typeof fetchMlbBoxScore>>>();

  let settled = 0;
  const next: StoredPick[] = [];

  for (const pick of picks) {
    if (pick.status !== "open") {
      next.push(pick);
      continue;
    }

    if (isPropMarket(String(pick.market))) {
      const cacheKey = `${pick.homeTeam}::${pick.awayTeam}::${pick.commenceTime}`;
      let box = boxCache.get(cacheKey);
      if (box === undefined) {
        box = await fetchMlbBoxScore({
          homeTeam: pick.homeTeam,
          awayTeam: pick.awayTeam,
          commenceTime: pick.commenceTime,
        });
        boxCache.set(cacheKey, box);
      }
      if (!box) {
        next.push(pick);
        continue;
      }
      const outcome = settlePropAgainstBox(pick, box);
      if (!outcome) {
        next.push(pick);
        continue;
      }
      settled += 1;
      next.push({
        ...pick,
        status: outcome.status,
        result: {
          settledAt: new Date().toISOString(),
          homeScore: outcome.homeScore,
          awayScore: outcome.awayScore,
          note: outcome.note,
        },
      });
      continue;
    }

    const events = scoresBySport.get(String(pick.sport)) ?? [];
    const event = matchScoreEvent(pick, events);
    if (!event) {
      next.push(pick);
      continue;
    }
    const outcome = settleAgainstScores(pick, event);
    if (!outcome) {
      next.push(pick);
      continue;
    }
    settled += 1;
    const { status, ...result } = outcome;
    next.push({ ...pick, status, result });
  }

  await writePicks(next);

  const gradedForPaper = next
    .filter((p) => p.status === "won" || p.status === "lost" || p.status === "push" || p.status === "void")
    .map((p) => ({
      eventId: p.eventId,
      market: String(p.market),
      selection: p.selection,
      line: p.line,
      status: p.status as "won" | "lost" | "push" | "void",
    }));
  const { settlePaperAgainstPicks } = await import("./paper-book");
  await settlePaperAgainstPicks(gradedForPaper).catch(() => undefined);

  const { learnFromSettledPicks } = await import("./learn");
  const learned = await learnFromSettledPicks(next);

  return {
    picks: next,
    settled,
    stillOpen: next.filter((p) => p.status === "open").length,
    learned: learned.learned,
    modelUpdatedAt: learned.state.updatedAt,
  };
}
