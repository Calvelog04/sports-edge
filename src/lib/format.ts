export function formatAmerican(price: number): string {
  if (price > 0) return `+${price}`;
  return String(price);
}

export function formatEdge(edgePct: number): string {
  const sign = edgePct >= 0 ? "+" : "";
  return `${sign}${edgePct.toFixed(1)}%`;
}

export function formatKickoff(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function marketLabel(market: string): string {
  switch (market) {
    case "h2h":
      return "Moneyline";
    case "spreads":
      return "Spread";
    case "totals":
      return "Total";
    case "batter_hits":
      return "Player hits";
    case "batter_home_runs":
      return "Player HR";
    case "totals_1st_1_innings":
      return "1st inning total";
    default:
      return market;
  }
}
