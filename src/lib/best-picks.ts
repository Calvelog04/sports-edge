import { SPORT_OPTIONS } from "./odds-client";
import { buildEdges } from "./pipeline";
import type { GameTiming } from "./timing";
import type {
  BestPick,
  BestPicksResponse,
  EdgeOpportunity,
  ModelSignal,
  SportKey,
} from "./types";

/** Must clear both bars: likely to win the bet + priced with edge. */
const MIN_WIN_PROB = 0.55;
const MIN_EDGE_PCT = 1.5;
const MAX_PICKS = 25;

function blendScore(s: ModelSignal): number {
  // Favor win probability, but reward real price edge
  return s.modelProb * 100 + s.edgePct * 1.35;
}

function alignedPick(opp: EdgeOpportunity): BestPick | null {
  const candidates = opp.signals.filter(
    (s) => s.modelProb >= MIN_WIN_PROB && s.edgePct >= MIN_EDGE_PCT,
  );
  if (candidates.length === 0) return null;

  // Prefer moneyline when it qualifies; otherwise best qualifying market
  const h2h = candidates.filter((s) => s.market === "h2h");
  const pool = h2h.length > 0 ? h2h : candidates;
  const best = pool.reduce((a, b) => (blendScore(a) >= blendScore(b) ? a : b));

  return {
    id: `${opp.eventId}:${best.market}:${best.selection}:${best.line ?? ""}`,
    eventId: opp.eventId,
    sport: opp.sport,
    sportTitle: opp.sportTitle,
    commenceTime: opp.commenceTime,
    homeTeam: opp.homeTeam,
    awayTeam: opp.awayTeam,
    market: best.market,
    selection: best.selection,
    line: best.line,
    modelProb: best.modelProb,
    bookImpliedProb: best.bookImpliedProb,
    bestBook: best.bestBook,
    bestPrice: best.bestPrice,
    edgePct: best.edgePct,
    evPct: best.evPct,
    confidence: best.confidence,
    blendScore: blendScore(best),
    rationale: [
      `Clears both bars: model win ${(best.modelProb * 100).toFixed(1)}% and edge ${best.edgePct >= 0 ? "+" : ""}${best.edgePct.toFixed(1)}% vs the book`,
      ...best.rationale.slice(0, 3),
    ],
    rank: 0,
  };
}

export async function buildBestPicks(
  sport: SportKey | "all",
  timing: GameTiming = "upcoming",
): Promise<BestPicksResponse> {
  const sports: SportKey[] =
    sport === "all" ? SPORT_OPTIONS.map((s) => s.key) : [sport];

  const warnings: string[] = [
    `Best picks need both a high model win probability (≥${(MIN_WIN_PROB * 100).toFixed(0)}%) and a sportsbook edge (≥${MIN_EDGE_PCT.toFixed(1)}%). That is stricter than Edges or Suggested alone.`,
  ];

  // Shared wide slate with Edges/Best (odds + scored board cached ~60s)
  const results = await Promise.all(sports.map((s) => buildEdges(s, timing)));

  const anyLive = results.some((r) => r.mode === "live");
  for (const w of results.flatMap((r) => r.warnings)) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  const byEvent = new Map<string, BestPick>();
  for (const board of results) {
    for (const opp of board.opportunities) {
      const pick = alignedPick(opp);
      if (!pick) continue;
      const prev = byEvent.get(pick.eventId);
      if (!prev || pick.blendScore > prev.blendScore) {
        byEvent.set(pick.eventId, pick);
      }
    }
  }

  const picks = [...byEvent.values()]
    .sort((a, b) => b.blendScore - a.blendScore || b.modelProb - a.modelProb)
    .slice(0, MAX_PICKS)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  if (picks.length === 0) {
    warnings.push(
      "No picks currently clear both bars on this slate. Check Edges for price value or Suggested for win leans.",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: anyLive ? "live" : "unavailable",
    timing,
    sport,
    picks,
    warnings,
    thresholds: { minWinProb: MIN_WIN_PROB, minEdgePct: MIN_EDGE_PCT },
    oddsQuota: results.find((r) => r.oddsQuota)?.oddsQuota,
  };
}
