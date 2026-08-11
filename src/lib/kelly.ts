/** Fractional Kelly stake as fraction of bankroll (0–1). */
export function fractionalKelly(opts: {
  modelProb: number;
  americanOdds: number;
  fraction?: number;
}): number {
  const { modelProb: p, americanOdds, fraction = 0.25 } = opts;
  if (p <= 0 || p >= 1) return 0;
  const decimal =
    americanOdds > 0 ? americanOdds / 100 + 1 : 100 / Math.abs(americanOdds) + 1;
  const b = decimal - 1;
  if (b <= 0) return 0;
  const q = 1 - p;
  const full = (b * p - q) / b;
  if (full <= 0) return 0;
  return Math.min(0.05, Math.max(0, full * fraction)); // cap 5% bankroll
}

export function kellyPctLabel(kellyFraction: number): string {
  return `${(kellyFraction * 100).toFixed(2)}% bankroll`;
}
