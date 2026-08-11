import { promises as fs } from "fs";
import path from "path";
import type { MarketKey, ModelWeights } from "./types";

export interface MarketStats {
  correct: number;
  total: number;
}

export interface DailyLearnLog {
  date: string;
  samples: number;
  winRate: number;
  brier: number;
  note: string;
}

export interface CalibrationBucket {
  label: string;
  lo: number;
  hi: number;
  predictedSum: number;
  actualSum: number;
  n: number;
}

export interface ModelWeightsByMarket {
  h2h: ModelWeights;
  spreads: ModelWeights;
  totals: ModelWeights;
  props: ModelWeights;
}

export interface ModelState {
  version: 2;
  updatedAt: string;
  lastLearnDate: string | null;
  samplesLearned: number;
  weights: ModelWeights;
  weightsByMarket: ModelWeightsByMarket;
  homeAdvantage: number;
  convictionScale: number;
  edgeMinPct: number;
  edgeMinByMarket: Partial<Record<MarketKey, number>>;
  teamElo: Record<string, number>;
  marketStats: Record<string, MarketStats>;
  dailyLog: DailyLearnLog[];
  calibration: CalibrationBucket[];
  minSamplesForWeightTune: number;
}

export const DEFAULT_WEIGHTS: ModelWeights = {
  elo: 0.22,
  form: 0.14,
  history: 0.14,
  savant: 0.18,
  market: 0.2,
  pitcher: 0.12,
};

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "model-state.json");

function defaultCalibration(): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < 10; i++) {
    const lo = i / 10;
    const hi = (i + 1) / 10;
    buckets.push({
      label: ((lo + hi) / 2).toFixed(2),
      lo,
      hi,
      predictedSum: 0,
      actualSum: 0,
      n: 0,
    });
  }
  return buckets;
}

function defaultWeightsByMarket(): ModelWeightsByMarket {
  return {
    h2h: { ...DEFAULT_WEIGHTS },
    spreads: { ...DEFAULT_WEIGHTS, market: 0.28, elo: 0.2, pitcher: 0.08, savant: 0.14 },
    totals: { ...DEFAULT_WEIGHTS, market: 0.3, savant: 0.2, pitcher: 0.1, elo: 0.15 },
    props: {
      ...DEFAULT_WEIGHTS,
      market: 0.4,
      savant: 0.25,
      pitcher: 0.05,
      elo: 0.1,
      form: 0.1,
      history: 0.1,
    },
  };
}

export function defaultModelState(): ModelState {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    lastLearnDate: null,
    samplesLearned: 0,
    weights: { ...DEFAULT_WEIGHTS },
    weightsByMarket: defaultWeightsByMarket(),
    homeAdvantage: 55,
    convictionScale: 1,
    edgeMinPct: 1.5,
    edgeMinByMarket: {
      h2h: 1.5,
      spreads: 1.5,
      totals: 1.5,
      batter_hits: 1.25,
      batter_home_runs: 1.25,
      totals_1st_1_innings: 1.25,
    },
    teamElo: {},
    marketStats: {
      h2h: { correct: 0, total: 0 },
      spreads: { correct: 0, total: 0 },
      totals: { correct: 0, total: 0 },
      batter_hits: { correct: 0, total: 0 },
      batter_home_runs: { correct: 0, total: 0 },
      totals_1st_1_innings: { correct: 0, total: 0 },
    },
    dailyLog: [],
    calibration: defaultCalibration(),
    minSamplesForWeightTune: 15,
  };
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadModelState(): Promise<ModelState> {
  await ensureDir();
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ModelState>;
    const base = defaultModelState();
    return {
      ...base,
      ...parsed,
      version: 2,
      weights: { ...DEFAULT_WEIGHTS, ...parsed.weights },
      weightsByMarket: {
        ...base.weightsByMarket,
        ...parsed.weightsByMarket,
        h2h: { ...base.weightsByMarket.h2h, ...parsed.weightsByMarket?.h2h },
        spreads: { ...base.weightsByMarket.spreads, ...parsed.weightsByMarket?.spreads },
        totals: { ...base.weightsByMarket.totals, ...parsed.weightsByMarket?.totals },
        props: { ...base.weightsByMarket.props, ...parsed.weightsByMarket?.props },
      },
      marketStats: { ...base.marketStats, ...parsed.marketStats },
      edgeMinByMarket: { ...base.edgeMinByMarket, ...parsed.edgeMinByMarket },
      teamElo: parsed.teamElo ?? {},
      dailyLog: Array.isArray(parsed.dailyLog) ? parsed.dailyLog : [],
      calibration:
        Array.isArray(parsed.calibration) && parsed.calibration.length > 0
          ? parsed.calibration
          : defaultCalibration(),
      minSamplesForWeightTune: parsed.minSamplesForWeightTune ?? 15,
    };
  } catch {
    const fresh = defaultModelState();
    await saveModelState(fresh);
    return fresh;
  }
}

export async function saveModelState(state: ModelState): Promise<void> {
  await ensureDir();
  const next = { ...state, updatedAt: new Date().toISOString(), version: 2 as const };
  await fs.writeFile(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
}

export function teamEloKey(sport: string, team: string): string {
  return `${sport}::${team.trim().toLowerCase()}`;
}

export function getTeamElo(state: ModelState, sport: string, team: string): number {
  return state.teamElo[teamEloKey(sport, team)] ?? 1500;
}

export function dateKeyLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function weightsForMarket(state: ModelState, market: MarketKey): ModelWeights {
  if (market === "h2h") return state.weightsByMarket.h2h;
  if (market === "spreads") return state.weightsByMarket.spreads;
  if (market === "totals") return state.weightsByMarket.totals;
  return state.weightsByMarket.props;
}

export function edgeMinForMarket(state: ModelState, market: MarketKey): number {
  return state.edgeMinByMarket[market] ?? state.edgeMinPct;
}

export function recordCalibration(
  state: ModelState,
  modelProb: number,
  won: boolean,
): void {
  const bucket =
    state.calibration.find((b) => modelProb >= b.lo && modelProb < b.hi) ??
    state.calibration[state.calibration.length - 1];
  if (!bucket) return;
  bucket.n += 1;
  bucket.predictedSum += modelProb;
  bucket.actualSum += won ? 1 : 0;
}

export function calibrationAllowsBoost(state: ModelState): boolean {
  const usable = state.calibration.filter((b) => b.n >= 5);
  if (usable.length < 3) return false;
  let err = 0;
  for (const b of usable) {
    err += Math.abs(b.predictedSum / b.n - b.actualSum / b.n);
  }
  return err / usable.length < 0.08;
}
