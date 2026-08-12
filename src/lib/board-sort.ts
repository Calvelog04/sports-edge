/** Shared board list ordering — kickoff / tipoff via commenceTime. */

function commenceMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** Earliest tipoff first. Invalid/missing times sort last. */
export function compareByCommenceAsc(
  a: { commenceTime: string },
  b: { commenceTime: string },
): number {
  return commenceMs(a.commenceTime) - commenceMs(b.commenceTime);
}
