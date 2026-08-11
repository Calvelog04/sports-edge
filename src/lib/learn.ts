import type { StoredPick } from "./picks";
import {
  DEFAULT_WEIGHTS,
  calibrationAllowsBoost,
  dateKeyLocal,
  defaultModelState,
  getTeamElo,
  loadModelState,
  recordCalibration,
  saveModelState,
  teamEloKey,
  type ModelState,
} from "./model-state";
import { readPaperBook } from "./paper-book";
import type { ModelWeights } from "./types";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeWeights(w: ModelWeights): ModelWeights {
  const sum = w.elo + w.form + w.history + w.savant + w.market + w.pitcher;
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return {
    elo: w.elo / sum,
    form: w.form / sum,
    history: w.history / sum,
    savant: w.savant / sum,
    market: w.market / sum,
    pitcher: w.pitcher / sum,
  };
}

function updateEloPair(
  state: ModelState,
  sport: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number,
  k = 24,
): void {
  const homeKey = teamEloKey(sport, homeTeam);
  const awayKey = teamEloKey(sport, awayTeam);
  const homeElo = getTeamElo(state, sport, homeTeam);
  const awayElo = getTeamElo(state, sport, awayTeam);
  const expectedHome = 1 / (1 + 10 ** (-(homeElo + state.homeAdvantage - awayElo) / 400));
  let actualHome = 0.5;
  if (homeScore > awayScore) actualHome = 1;
  else if (homeScore < awayScore) actualHome = 0;
  const delta = k * (actualHome - expectedHome);
  state.teamElo[homeKey] = homeElo + delta;
  state.teamElo[awayKey] = awayElo - delta;
}

type Graded = {
  sport: string;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  modelProb: number;
  status: "won" | "lost";
  homeScore: number;
  awayScore: number;
  settledAt: string;
};

function fromPicks(picks: StoredPick[]): Graded[] {
  return picks
    .filter(
      (p) =>
        (p.status === "won" || p.status === "lost") &&
        p.result &&
        Number.isFinite(p.result.homeScore) &&
        Number.isFinite(p.result.awayScore),
    )
    .map((p) => ({
      sport: String(p.sport),
      eventId: p.eventId,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      market: String(p.market),
      modelProb: p.modelProb,
      status: p.status as "won" | "lost",
      homeScore: p.result!.homeScore,
      awayScore: p.result!.awayScore,
      settledAt: p.result!.settledAt,
    }));
}

async function fromPaper(): Promise<Graded[]> {
  const book = await readPaperBook();
  return book
    .filter((b) => b.status === "won" || b.status === "lost")
    .map((b) => ({
      sport: b.sport,
      eventId: b.eventId,
      homeTeam: b.homeTeam,
      awayTeam: b.awayTeam,
      market: String(b.market),
      modelProb: b.modelProb,
      status: b.status as "won" | "lost",
      homeScore: 0,
      awayScore: 0,
      settledAt: b.recordedAt,
    }));
}

export async function learnFromSettledPicks(picks: StoredPick[]): Promise<{
  state: ModelState;
  learned: number;
  alreadyCurrent: boolean;
}> {
  const prev = await loadModelState();
  const today = dateKeyLocal();

  const fromSaved = fromPicks(picks);
  const paper = await fromPaper();
  const graded = [...fromSaved];
  for (const p of paper) {
    const dup = graded.some(
      (g) =>
        g.eventId === p.eventId &&
        g.market === p.market &&
        Math.abs(g.modelProb - p.modelProb) < 0.02,
    );
    if (!dup) graded.push(p);
  }

  graded.sort((a, b) => Date.parse(a.settledAt) - Date.parse(b.settledAt));

  if (graded.length === 0) {
    return { state: prev, learned: 0, alreadyCurrent: prev.lastLearnDate === today };
  }

  const state = defaultModelState();
  state.homeAdvantage = prev.homeAdvantage;
  state.dailyLog = prev.dailyLog;
  state.teamElo = { ...prev.teamElo };
  state.minSamplesForWeightTune = prev.minSamplesForWeightTune;
  state.calibration = defaultModelState().calibration;

  let brierSum = 0;
  let wins = 0;

  // Elo from saved picks with real scores only
  const eloSeen = new Set<string>();
  for (const pick of fromSaved) {
    const gameKey = `${pick.sport}::${pick.eventId}`;
    if (eloSeen.has(gameKey)) continue;
    eloSeen.add(gameKey);
    updateEloPair(
      state,
      pick.sport,
      pick.homeTeam,
      pick.awayTeam,
      pick.homeScore,
      pick.awayScore,
    );
  }

  for (const pick of graded) {
    const won = pick.status === "won";
    if (won) wins += 1;
    brierSum += (pick.modelProb - (won ? 1 : 0)) ** 2;
    recordCalibration(state, pick.modelProb, won);

    const ms = state.marketStats[pick.market] ?? { correct: 0, total: 0 };
    ms.total += 1;
    if (won) ms.correct += 1;
    state.marketStats[pick.market] = ms;
  }

  const n = graded.length;
  const winRate = wins / n;
  const brier = brierSum / n;
  const allowTune = n >= state.minSamplesForWeightTune;
  const allowBoost = calibrationAllowsBoost(state);

  // Conviction: conservative until calibrated
  let conviction = 1;
  if (brier > 0.3) conviction = 0.75;
  else if (brier > 0.26) conviction = 0.88;
  else if (allowBoost && brier < 0.18 && winRate > 0.55) conviction = 1.12;
  else if (allowBoost && brier < 0.22 && winRate > 0.52) conviction = 1.05;
  state.convictionScale = clamp(conviction, 0.55, 1.25);

  let edgeMin = 1.5;
  if (allowTune && winRate < 0.45) edgeMin = 2.4;
  else if (allowTune && winRate < 0.5) edgeMin = 2.0;
  else if (allowTune && winRate > 0.58) edgeMin = 1.2;
  else if (allowTune && winRate > 0.53) edgeMin = 1.35;
  state.edgeMinPct = clamp(edgeMin, 1.0, 4.0);

  // Keep prior weights until enough samples (gate #10)
  if (!allowTune) {
    state.weights = { ...prev.weights };
    state.weightsByMarket = {
      h2h: { ...prev.weightsByMarket.h2h },
      spreads: { ...prev.weightsByMarket.spreads },
      totals: { ...prev.weightsByMarket.totals },
      props: { ...prev.weightsByMarket.props },
    };
    state.edgeMinByMarket = { ...prev.edgeMinByMarket };
  } else {
    const w = { ...DEFAULT_WEIGHTS };
    const h2hRate =
      state.marketStats.h2h?.total > 0
        ? state.marketStats.h2h.correct / state.marketStats.h2h.total
        : 0.5;
    if (h2hRate > 0.55) {
      w.elo += 0.03;
      w.pitcher += 0.02;
      w.savant += 0.02;
      w.market -= 0.05;
    } else if (h2hRate < 0.45 && (state.marketStats.h2h?.total ?? 0) >= 5) {
      w.market += 0.05;
      w.elo -= 0.02;
    }
    if (winRate > 0.55) {
      w.pitcher += 0.02;
      w.savant += 0.02;
    } else if (winRate < 0.45) {
      w.market += 0.03;
    }
    state.weights = normalizeWeights(w);
    state.weightsByMarket = {
      h2h: normalizeWeights({ ...w }),
      spreads: normalizeWeights({ ...w, market: w.market + 0.05, pitcher: w.pitcher - 0.03 }),
      totals: normalizeWeights({ ...w, savant: w.savant + 0.04, market: w.market + 0.04 }),
      props: normalizeWeights({ ...w, market: w.market + 0.1, savant: w.savant + 0.05 }),
    };
    state.edgeMinByMarket = {
      h2h: state.edgeMinPct,
      spreads: state.edgeMinPct,
      totals: state.edgeMinPct,
      batter_hits: Math.max(1.0, state.edgeMinPct - 0.25),
      batter_home_runs: Math.max(1.0, state.edgeMinPct - 0.25),
      totals_1st_1_innings: Math.max(1.0, state.edgeMinPct - 0.25),
    };
  }

  state.samplesLearned = n;
  state.lastLearnDate = today;
  const note = `winRate=${(winRate * 100).toFixed(1)}% brier=${brier.toFixed(3)} n=${n} tune=${allowTune} scale=${state.convictionScale.toFixed(2)}`;
  const withoutToday = state.dailyLog.filter((d) => d.date !== today);
  withoutToday.unshift({ date: today, samples: n, winRate, brier, note });
  state.dailyLog = withoutToday.slice(0, 60);

  await saveModelState(state);
  return { state, learned: n, alreadyCurrent: false };
}

export async function learnIfNeeded(picks: StoredPick[]): Promise<{
  state: ModelState;
  ran: boolean;
  learned: number;
}> {
  const state = await loadModelState();
  const today = dateKeyLocal();
  const graded = picks.filter((p) => p.status === "won" || p.status === "lost");
  const paper = await readPaperBook();
  const paperGraded = paper.filter((p) => p.status === "won" || p.status === "lost").length;
  const total = graded.length + paperGraded;
  if (state.lastLearnDate === today && total === state.samplesLearned) {
    return { state, ran: false, learned: 0 };
  }
  if (total === 0) {
    return { state, ran: false, learned: 0 };
  }
  const result = await learnFromSettledPicks(picks);
  return { state: result.state, ran: true, learned: result.learned };
}

export function applyConviction(prob: number, scale: number): number {
  const centered = prob - 0.5;
  return clamp(0.5 + centered * scale, 0.12, 0.88);
}
