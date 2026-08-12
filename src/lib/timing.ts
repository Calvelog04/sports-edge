import type { EdgeOpportunity } from "./types";

export type GameTiming = "live" | "upcoming";

/** Live game-result boards (ML / spread / total) via ESPN. */
export const LIVE_BETS_ENABLED = true;

/** Live player props via ESPN (hits / HRs) while games are in progress. */
export const LIVE_PROPS_ENABLED = true;

export type GamePhase = "scheduled" | "in_progress" | "final";

export function isLiveGame(commenceTime: string, now = Date.now()): boolean {
  const start = new Date(commenceTime).getTime();
  if (Number.isNaN(start)) return false;
  return start <= now;
}

export function phaseFromCommence(
  commenceTime: string,
  now = Date.now(),
  maxLiveMs = 6 * 60 * 60 * 1000,
): GamePhase {
  const start = new Date(commenceTime).getTime();
  if (Number.isNaN(start)) return "scheduled";
  if (start > now) return "scheduled";
  if (now - start <= maxLiveMs) return "in_progress";
  return "final";
}

export function filterByTiming(
  opportunities: EdgeOpportunity[],
  timing: GameTiming,
  now = Date.now(),
): EdgeOpportunity[] {
  const effective: GameTiming = LIVE_BETS_ENABLED ? timing : "upcoming";
  return opportunities.filter((opp) => {
    const phase = opp.gamePhase ?? phaseFromCommence(opp.commenceTime, now);
    if (phase === "final") return false;
    const live = phase === "in_progress";
    return effective === "live" ? live : !live;
  });
}

export function parseTiming(value: string | null | undefined): GameTiming {
  if (!LIVE_BETS_ENABLED) return "upcoming";
  return value === "live" ? "live" : "upcoming";
}

/** Props API always upcoming unless LIVE_PROPS_ENABLED. */
export function parsePropsTiming(value: string | null | undefined): GameTiming {
  if (!LIVE_PROPS_ENABLED) return "upcoming";
  return value === "live" ? "live" : "upcoming";
}
