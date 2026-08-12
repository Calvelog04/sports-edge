import { promises as fs } from "fs";
import path from "path";
import { fetchMlbBoxScore, settlePropAgainstBox } from "./boxscore";
import { gameDateKey, picksMatch } from "./pick-identity";
import {
  fetchEspnScoreEventForPick,
  scoreNamesMatch,
  commenceTimesAlign,
  type ScoreEvent,
} from "./scores";
import { isPropMarket } from "./types";
import type { MarketKey, SportKey } from "./types";

export type PickStatus = "open" | "won" | "lost" | "push" | "void";

/** Which board the user saved the pick from. */
export type PickBoardSource = "edges" | "suggested" | "best" | "props";

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
  /** Board the pick was saved from (Best / Suggested / Edges / Props). */
  boardSource?: PickBoardSource;
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
  boardSource?: PickBoardSource;
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

function normalizeBoardSource(
  raw: unknown,
  market: MarketKey | string,
): PickBoardSource | undefined {
  if (raw === "edges" || raw === "suggested" || raw === "best" || raw === "props") {
    return raw;
  }
  if (isPropMarket(String(market))) return "props";
  return undefined;
}

export async function addPick(input: CreatePickInput): Promise<StoredPick> {
  const picks = await readPicks();
  const player = inferPlayer(input);
  const normalizedSelection = isPropMarket(String(input.market))
    ? normalizeOuSelection(input.selection)
    : input.selection;
  const boardSource = normalizeBoardSource(input.boardSource, input.market);

  const dup = picks.find(
    (p) =>
      p.status === "open" &&
      picksMatch(
        {
          eventId: p.eventId,
          market: p.market,
          selection: p.selection,
          line: p.line,
          player: p.player,
          homeTeam: p.homeTeam,
          awayTeam: p.awayTeam,
          commenceTime: p.commenceTime,
        },
        {
          eventId: input.eventId,
          market: input.market,
          selection: normalizedSelection,
          line: input.line,
          player,
          homeTeam: input.homeTeam,
          awayTeam: input.awayTeam,
          commenceTime: input.commenceTime,
        },
      ),
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
    boardSource,
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

function namesMatch(a: string, b: string): boolean {
  return scoreNamesMatch(a, b);
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

  // Never grade a pick with another day's final (common in multi-game series).
  if (
    event.commence_time &&
    pick.commenceTime &&
    !commenceTimesAlign(pick.commenceTime, event.commence_time)
  ) {
    return null;
  }

  // Game must have started (small grace for early official postings).
  const tip = Date.parse(pick.commenceTime);
  if (Number.isFinite(tip) && Date.now() < tip - 5 * 60_000) {
    return null;
  }

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

export async function settleOpenPicks(): Promise<{
  picks: StoredPick[];
  settled: number;
  stillOpen: number;
  learned: number;
  modelUpdatedAt: string | null;
}> {
  let picks = await readPicks();

  // Undo grades that fired before tipoff, or that don't cite the bet's slate day.
  let reopened = 0;
  picks = picks.map((p) => {
    if (p.status === "open" || !p.result?.settledAt) return p;
    const tip = Date.parse(p.commenceTime);
    const gradedAt = Date.parse(p.result.settledAt);
    const day = gameDateKey(p.commenceTime);
    const note = p.result.note ?? "";
    const premature =
      Number.isFinite(tip) && Number.isFinite(gradedAt) && gradedAt + 5 * 60_000 < tip;
    // Legacy wrong-day grades lack the ESPN day tag; reopen game-line results so they
    // can be re-checked against the bet's listed date on ESPN.
    const missingEspnDayTag =
      !isPropMarket(String(p.market)) && day && !note.includes(`ESPN ${day}`);
    // Prop grades must cite `· day YYYY-MM-DD` matching the bet's CT slate day
    // (legacy notes used the prior series gamePk without a day tag).
    const missingPropDayTag =
      isPropMarket(String(p.market)) && day && !note.includes(`· day ${day}`);
    if (premature || missingEspnDayTag || missingPropDayTag) {
      reopened += 1;
      const { result: _r, ...rest } = p;
      return { ...rest, status: "open" as const };
    }
    return p;
  });
  if (reopened > 0) {
    await writePicks(picks);
  }

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

  // Box-score cache keyed by matchup+date for MLB props
  const boxCache = new Map<string, Awaited<ReturnType<typeof fetchMlbBoxScore>>>();
  // ESPN finals keyed by sport+teams+slate day
  const espnCache = new Map<string, ScoreEvent | null>();

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

      // Cross-check MLB box final vs ESPN final for the same CT day.
      const espnKey = `${pick.sport}::${pick.homeTeam}::${pick.awayTeam}::${pick.commenceTime}`;
      let espnEvent = espnCache.get(espnKey);
      if (espnEvent === undefined) {
        espnEvent = await fetchEspnScoreEventForPick({
          sport: String(pick.sport),
          homeTeam: pick.homeTeam,
          awayTeam: pick.awayTeam,
          commenceTime: pick.commenceTime,
        });
        espnCache.set(espnKey, espnEvent);
      }
      if (espnEvent?.completed && espnEvent.scores?.length) {
        const espnHome =
          scoreFor(espnEvent, pick.homeTeam) ?? scoreFor(espnEvent, espnEvent.home_team);
        const espnAway =
          scoreFor(espnEvent, pick.awayTeam) ?? scoreFor(espnEvent, espnEvent.away_team);
        if (
          espnHome != null &&
          espnAway != null &&
          (box.homeScore !== espnHome || box.awayScore !== espnAway)
        ) {
          // Wrong series game (or stale box) — do not grade.
          next.push(pick);
          continue;
        }
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

    // Game lines: ESPN scoreboard for the bet's listed CT date only.
    const espnKey = `${pick.sport}::${pick.homeTeam}::${pick.awayTeam}::${pick.commenceTime}`;
    let event = espnCache.get(espnKey);
    if (event === undefined) {
      event = await fetchEspnScoreEventForPick({
        sport: String(pick.sport),
        homeTeam: pick.homeTeam,
        awayTeam: pick.awayTeam,
        commenceTime: pick.commenceTime,
      });
      espnCache.set(espnKey, event);
    }
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
    next.push({
      ...pick,
      status,
      result: {
        ...result,
        note: `${result.note} · ESPN ${gameDateKey(pick.commenceTime) || "day"}`,
      },
    });
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
