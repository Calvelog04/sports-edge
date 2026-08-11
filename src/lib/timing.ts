import type { EdgeOpportunity } from "./types";

export type GameTiming = "live" | "upcoming";

export function isLiveGame(commenceTime: string, now = Date.now()): boolean {
  const start = new Date(commenceTime).getTime();
  if (Number.isNaN(start)) return false;
  return start <= now;
}

export function filterByTiming(
  opportunities: EdgeOpportunity[],
  timing: GameTiming,
  now = Date.now(),
): EdgeOpportunity[] {
  return opportunities.filter((opp) => {
    const live = isLiveGame(opp.commenceTime, now);
    return timing === "live" ? live : !live;
  });
}

export function parseTiming(value: string | null | undefined): GameTiming {
  return value === "live" ? "live" : "upcoming";
}
