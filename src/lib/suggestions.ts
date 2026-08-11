import { SPORT_OPTIONS } from "./odds-client";
import { buildEdges } from "./pipeline";
import type { GameTiming } from "./timing";
import type {
  EdgeOpportunity,
  SportKey,
  SuggestedPick,
  SuggestionsResponse,
} from "./types";

const MIN_WIN_PROB = 0.52;
const MAX_SUGGESTIONS = 25;

function moneylineWinner(opp: EdgeOpportunity): SuggestedPick | null {
  const mls = opp.signals.filter((s) => s.market === "h2h");
  if (mls.length === 0) return null;

  // Side the model thinks is more likely to win
  const best = mls.reduce((a, b) => (a.modelProb >= b.modelProb ? a : b));
  if (best.modelProb < MIN_WIN_PROB) return null;

  return {
    id: `${opp.eventId}:h2h:${best.selection}`,
    eventId: opp.eventId,
    sport: opp.sport,
    sportTitle: opp.sportTitle,
    commenceTime: opp.commenceTime,
    homeTeam: opp.homeTeam,
    awayTeam: opp.awayTeam,
    market: "h2h",
    selection: best.selection,
    modelProb: best.modelProb,
    bookImpliedProb: best.bookImpliedProb,
    bestBook: best.bestBook,
    bestPrice: best.bestPrice,
    edgePct: best.edgePct,
    evPct: best.evPct,
    confidence: best.confidence,
    rationale: [
      `Model win probability ${(best.modelProb * 100).toFixed(1)}% — strongest lean in this game`,
      ...best.rationale.slice(0, 3),
    ],
    rank: 0,
  };
}

export async function buildSuggestions(
  sport: SportKey | "all",
  timing: GameTiming = "upcoming",
): Promise<SuggestionsResponse> {
  const sports: SportKey[] =
    sport === "all" ? SPORT_OPTIONS.map((s) => s.key) : [sport];

  const warnings: string[] = [
    "Suggested picks rank games by model win probability (who the model thinks will win), not by edge %. A high win % is not a guarantee and is not the same as a soft book price.",
  ];

  // Same shared wide slate as Edges/Best — one scan, no extra Odds API burns
  const results = await Promise.all(
    sports.map((s) => buildEdges(s, timing, { edgeFloor: -50 })),
  );

  const anyLive = results.some((r) => r.mode === "live");
  for (const w of results.flatMap((r) => r.warnings)) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  const byEvent = new Map<string, SuggestedPick>();
  for (const board of results) {
    for (const opp of board.opportunities) {
      const pick = moneylineWinner(opp);
      if (!pick) continue;
      const prev = byEvent.get(pick.eventId);
      if (!prev || pick.modelProb > prev.modelProb) {
        byEvent.set(pick.eventId, pick);
      }
    }
  }

  const suggestions = [...byEvent.values()]
    .sort((a, b) => b.modelProb - a.modelProb || b.edgePct - a.edgePct)
    .slice(0, MAX_SUGGESTIONS)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  if (suggestions.length === 0) {
    warnings.push(
      "No moneyline leans above 52% model win probability on this slate — try another sport or timing.",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: anyLive ? "live" : "unavailable",
    timing,
    sport,
    suggestions,
    warnings,
    oddsQuota: results.find((r) => r.oddsQuota)?.oddsQuota,
  };
}
