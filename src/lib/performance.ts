import { americanToDecimal } from "./odds";
import { loadModelState } from "./model-state";
import { paperPerformance, readPaperBook } from "./paper-book";
import { readPicks, type StoredPick } from "./picks";

export interface PerformanceSnapshot {
  generatedAt: string;
  picks: {
    open: number;
    graded: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number | null;
    roiPct: number | null;
    brier: number | null;
    avgClvPct: number | null;
    units: number | null;
  };
  paper: ReturnType<typeof paperPerformance>;
  model: {
    samplesLearned: number;
    convictionScale: number;
    edgeMinPct: number;
    lastLearnDate: string | null;
    minSamplesForWeightTune: number;
    calibrationBuckets: Array<{
      label: string;
      n: number;
      predicted: number | null;
      actual: number | null;
    }>;
    dailyLog: Array<{
      date: string;
      samples: number;
      winRate: number;
      brier: number;
      note: string;
    }>;
  };
}

function pickClvPct(p: StoredPick): number | null {
  const open = p.openPrice ?? p.price;
  // Without a true close we approximate CLV vs settled price movement unavailable;
  // use 0 when open===price (no move tracked on saved picks alone).
  if (open === p.price) return 0;
  const toImp = (american: number) =>
    american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
  return (toImp(open) - toImp(p.price)) * 100;
}

function flatStakeRoi(picks: StoredPick[]): {
  roiPct: number | null;
  units: number | null;
} {
  const graded = picks.filter((p) => p.status === "won" || p.status === "lost");
  if (graded.length === 0) return { roiPct: null, units: null };
  let profit = 0;
  for (const p of graded) {
    const dec = americanToDecimal(p.price);
    if (p.status === "won") profit += dec - 1;
    else profit -= 1;
  }
  return { roiPct: (profit / graded.length) * 100, units: profit };
}

export async function buildPerformance(): Promise<PerformanceSnapshot> {
  const [picks, paper, state] = await Promise.all([
    readPicks(),
    readPaperBook(),
    loadModelState(),
  ]);

  const graded = picks.filter((p) => p.status === "won" || p.status === "lost");
  const wins = graded.filter((p) => p.status === "won").length;
  const losses = graded.filter((p) => p.status === "lost").length;
  let brier = 0;
  for (const p of graded) {
    brier += (p.modelProb - (p.status === "won" ? 1 : 0)) ** 2;
  }
  const clvs = picks
    .map(pickClvPct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const { roiPct, units } = flatStakeRoi(picks);

  return {
    generatedAt: new Date().toISOString(),
    picks: {
      open: picks.filter((p) => p.status === "open").length,
      graded: graded.length,
      wins,
      losses,
      pushes: picks.filter((p) => p.status === "push").length,
      winRate: graded.length ? wins / graded.length : null,
      roiPct,
      brier: graded.length ? brier / graded.length : null,
      avgClvPct: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
      units,
    },
    paper: paperPerformance(paper),
    model: {
      samplesLearned: state.samplesLearned,
      convictionScale: state.convictionScale,
      edgeMinPct: state.edgeMinPct,
      lastLearnDate: state.lastLearnDate,
      minSamplesForWeightTune: state.minSamplesForWeightTune,
      calibrationBuckets: state.calibration.map((b) => ({
        label: b.label,
        n: b.n,
        predicted: b.n ? b.predictedSum / b.n : null,
        actual: b.n ? b.actualSum / b.n : null,
      })),
      dailyLog: state.dailyLog.slice(0, 14),
    },
  };
}
