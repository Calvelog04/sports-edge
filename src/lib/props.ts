import { americanToDecimal, americanToImplied, fetchEventOdds, fetchSportEvents, removeVig } from "./odds";
import { getOddsQuota } from "./odds-quota";
import { getSavantMatchup } from "./savant";
import { findSavantPlayer, loadSavantPlayers, type SavantPlayerRate } from "./savant-players";
import { isLiveGame, type GameTiming } from "./timing";
import type {
  Bookmaker,
  PropMarketKey,
  PropOpportunity,
  PropsResponse,
  SavantMatchupContext,
} from "./types";

const PROP_MARKETS: PropMarketKey[] = [
  "batter_hits",
  "batter_home_runs",
  "totals_1st_1_innings",
];

const MAX_EVENTS = 8;
const EDGE_MIN = 1.25;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function categoryFor(market: PropMarketKey): PropOpportunity["category"] {
  if (market === "batter_hits") return "hit";
  if (market === "batter_home_runs") return "home_run";
  return "first_inning";
}

function propLabel(opts: {
  market: PropMarketKey;
  player?: string;
  selection: string;
  line?: number;
}): string {
  if (opts.market === "batter_hits" && opts.player) {
    if (opts.selection === "Over" && (opts.line == null || opts.line === 0.5)) {
      return `${opts.player} to record a hit`;
    }
    return `${opts.player} hits ${opts.selection}${opts.line != null ? ` ${opts.line}` : ""}`;
  }
  if (opts.market === "batter_home_runs" && opts.player) {
    if (opts.selection === "Over" && (opts.line == null || opts.line === 0.5)) {
      return `${opts.player} to record a home run`;
    }
    return `${opts.player} HR ${opts.selection}${opts.line != null ? ` ${opts.line}` : ""}`;
  }
  return `1st inning ${opts.selection}${opts.line != null ? ` ${opts.line}` : ""}`;
}

interface QuotedSide {
  book: string;
  price: number;
  fairProb: number;
  point?: number;
}

function bestPlayerSide(
  bookmakers: Bookmaker[],
  market: PropMarketKey,
  player: string,
  side: "Over" | "Under",
  point?: number,
): QuotedSide | null {
  const quotes: Array<{ book: string; price: number; point?: number; fair: number }> = [];

  for (const book of bookmakers) {
    const mkt = book.markets.find((m) => m.key === market);
    if (!mkt) continue;

    const over = mkt.outcomes.find(
      (o) =>
        o.name === "Over" &&
        (o.description ?? "").toLowerCase() === player.toLowerCase() &&
        (point == null || o.point === point),
    );
    const under = mkt.outcomes.find(
      (o) =>
        o.name === "Under" &&
        (o.description ?? "").toLowerCase() === player.toLowerCase() &&
        (point == null || o.point === point),
    );
    if (!over || !under) continue;

    const [fairOver, fairUnder] = removeVig(
      americanToImplied(over.price),
      americanToImplied(under.price),
    );
    const chosen = side === "Over" ? over : under;
    const fair = side === "Over" ? fairOver : fairUnder;
    quotes.push({
      book: book.title,
      price: chosen.price,
      point: chosen.point,
      fair,
    });
  }

  if (quotes.length === 0) return null;

  // Best American price for the bettor
  const best = quotes.reduce((a, b) => (a.price > b.price ? a : b));
  const avgFair = quotes.reduce((s, q) => s + q.fair, 0) / quotes.length;

  return {
    book: best.book,
    price: best.price,
    point: best.point,
    fairProb: avgFair,
  };
}

function bestTotalSide(
  bookmakers: Bookmaker[],
  market: PropMarketKey,
  side: "Over" | "Under",
): QuotedSide | null {
  const quotes: Array<{ book: string; price: number; point?: number; fair: number }> = [];

  for (const book of bookmakers) {
    const mkt = book.markets.find((m) => m.key === market);
    if (!mkt) continue;
    const over = mkt.outcomes.find((o) => /^over$/i.test(o.name));
    const under = mkt.outcomes.find((o) => /^under$/i.test(o.name));
    if (!over || !under) continue;
    const [fairOver, fairUnder] = removeVig(
      americanToImplied(over.price),
      americanToImplied(under.price),
    );
    const chosen = side === "Over" ? over : under;
    quotes.push({
      book: book.title,
      price: chosen.price,
      point: chosen.point,
      fair: side === "Over" ? fairOver : fairUnder,
    });
  }

  if (quotes.length === 0) return null;
  const best = quotes.reduce((a, b) => (a.price > b.price ? a : b));
  const avgFair = quotes.reduce((s, q) => s + q.fair, 0) / quotes.length;
  return {
    book: best.book,
    price: best.price,
    point: best.point,
    fairProb: avgFair,
  };
}

function listPlayers(bookmakers: Bookmaker[], market: PropMarketKey): Array<{ player: string; point: number }> {
  const seen = new Set<string>();
  const out: Array<{ player: string; point: number }> = [];
  for (const book of bookmakers) {
    const mkt = book.markets.find((m) => m.key === market);
    if (!mkt) continue;
    for (const o of mkt.outcomes) {
      if (!o.description || o.point == null) continue;
      if (!/^over$/i.test(o.name)) continue;
      const key = `${o.description.toLowerCase()}::${o.point}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ player: o.description, point: o.point });
    }
  }
  return out;
}

/**
 * Soft prior for Yes-hit / Yes-HR when line is 0.5.
 * Anchors near typical MLB rates, then blends heavily with market fair.
 */
function playerPrior(
  market: PropMarketKey,
  side: "Over" | "Under",
  line: number | undefined,
  savant: SavantMatchupContext | null,
  playerRate: SavantPlayerRate | null,
): number | null {
  if (line != null && line !== 0.5) return null;

  let baseYes = market === "batter_home_runs" ? 0.11 : 0.62;

  if (playerRate) {
    if (market === "batter_home_runs" && playerRate.hrGamePrior != null) {
      baseYes = playerRate.hrGamePrior;
    } else if (market === "batter_hits" && playerRate.hitGamePrior != null) {
      baseYes = playerRate.hitGamePrior;
    }
  } else if (savant) {
    const offense =
      ((savant.home.hitting?.rankXwoba ?? 0.5) + (savant.away.hitting?.rankXwoba ?? 0.5)) / 2;
    if (market === "batter_home_runs") {
      baseYes = clamp(0.08 + offense * 0.1, 0.06, 0.2);
    } else {
      baseYes = clamp(0.55 + offense * 0.12, 0.5, 0.72);
    }
  }

  return side === "Over" ? baseYes : 1 - baseYes;
}

function firstInningPrior(
  side: "Over" | "Under",
  savant: SavantMatchupContext | null,
): number {
  // 1st-inning runs are scarce; main line often 0.5 / 1.5
  let overLean = 0.48;
  if (savant) {
    overLean = clamp(0.48 + savant.totalOverLean * 2.5, 0.4, 0.58);
  }
  return side === "Over" ? overLean : 1 - overLean;
}

function blendModel(fair: number, prior: number | null, priorWeight = 0.28): number {
  if (prior == null) return fair;
  return clamp(fair * (1 - priorWeight) + prior * priorWeight, 0.05, 0.92);
}

function pushProp(
  list: PropOpportunity[],
  partial: Omit<PropOpportunity, "id" | "edgePct" | "evPct" | "confidence" | "label" | "category"> & {
    category?: PropOpportunity["category"];
    forceBoard?: boolean;
  },
) {
  const edgePct = (partial.modelProb - partial.bookImpliedProb) * 100;
  const isRecordProp =
    partial.forceBoard ||
    ((partial.market === "batter_hits" || partial.market === "batter_home_runs") &&
      partial.selection === "Over" &&
      (partial.line == null || partial.line === 0.5));

  // Always surface "to record a hit/HR" board options; require edge on other lines
  if (!isRecordProp && edgePct < EDGE_MIN) return;
  if (isRecordProp && edgePct < -3) return;

  const { forceBoard: _f, ...rest } = partial;
  const decimal = americanToDecimal(partial.bestPrice);
  const evPct = (partial.modelProb * decimal - 1) * 100;
  const confidence = clamp(0.38 + Math.min(0.35, Math.abs(edgePct) / 18), 0.35, 0.88);
  const category = partial.category ?? categoryFor(partial.market);
  const label = propLabel({
    market: partial.market,
    player: partial.player,
    selection: partial.selection,
    line: partial.line,
  });

  list.push({
    ...rest,
    id: `${partial.eventId}:${partial.market}:${partial.player ?? ""}:${partial.selection}:${partial.line ?? ""}`,
    category,
    label,
    edgePct,
    evPct,
    confidence,
  });
}

function scoreEventProps(
  event: {
    id: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Bookmaker[];
  },
  savant: SavantMatchupContext | null,
  savantPlayers: SavantPlayerRate[],
): PropOpportunity[] {
  const out: PropOpportunity[] = [];
  const base = {
    eventId: event.id,
    sport: "baseball_mlb" as const,
    sportTitle: event.sport_title || "MLB",
    commenceTime: event.commence_time,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
  };

  for (const market of ["batter_hits", "batter_home_runs"] as const) {
    const players = listPlayers(event.bookmakers, market);
    for (const { player, point } of players) {
      for (const side of ["Over", "Under"] as const) {
        // Prefer "to record" markets (0.5) in the prop board; still allow other lines with edges
        if (point !== 0.5 && side === "Under") continue;

        const quote = bestPlayerSide(event.bookmakers, market, player, side, point);
        if (!quote) continue;

        const playerRate = findSavantPlayer(savantPlayers, player);
        const prior = playerPrior(market, side, point, savant, playerRate);
        const priorW = playerRate ? (point === 0.5 ? 0.42 : 0.18) : point === 0.5 ? 0.3 : 0.12;
        const modelProb = blendModel(quote.fairProb, prior, priorW);
        const bookImpliedProb = americanToImplied(quote.price);

        const rationale = [
          `Consensus fair ${(quote.fairProb * 100).toFixed(1)}% across books`,
          playerRate
            ? `Player Savant prior ${(prior! * 100).toFixed(1)}% (xwOBA ${playerRate.xwoba?.toFixed(3) ?? "—"})`
            : prior != null
              ? `Team Statcast prior ${(prior * 100).toFixed(1)}% blended in`
              : "Market-driven model (non-standard line)",
          point === 0.5 && side === "Over"
            ? market === "batter_hits"
              ? "Framed as player to record a hit (Over 0.5)"
              : "Framed as player to record a home run (Over 0.5)"
            : `Line ${side} ${point}`,
          `Best price at ${quote.book}`,
        ];

        pushProp(out, {
          ...base,
          market,
          player,
          selection: side,
          line: quote.point ?? point,
          bestBook: quote.book,
          bestPrice: quote.price,
          bookImpliedProb,
          modelProb,
          forceBoard: point === 0.5 && side === "Over",
          rationale,
        });
      }
    }
  }

  for (const side of ["Over", "Under"] as const) {
    const quote = bestTotalSide(event.bookmakers, "totals_1st_1_innings", side);
    if (!quote) continue;
    const prior = firstInningPrior(side, savant);
    const modelProb = blendModel(quote.fairProb, prior, 0.25);
    pushProp(out, {
      ...base,
      market: "totals_1st_1_innings",
      selection: side,
      line: quote.point,
      bestBook: quote.book,
      bestPrice: quote.price,
      bookImpliedProb: americanToImplied(quote.price),
      modelProb,
      forceBoard: true,
      rationale: [
        `1st-inning total consensus fair ${(quote.fairProb * 100).toFixed(1)}%`,
        `Run-environment prior ${(prior * 100).toFixed(1)}%`,
        quote.point != null ? `Main line ${quote.point}` : "1st inning runs",
        `Best price at ${quote.book}`,
      ],
    });
  }

  return out;
}

export async function buildMlbProps(timing: GameTiming = "upcoming"): Promise<PropsResponse> {
  const warnings: string[] = [];
  const { events, warning, fromCache } = await fetchSportEvents("baseball_mlb");
  if (warning) warnings.push(warning);
  if (fromCache) warnings.push("Events list served from Odds API cache (60s TTL).");

  if (events.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      mode: "unavailable",
      timing,
      opportunities: [],
      warnings: warnings.length
        ? warnings
        : ["No MLB events available for props right now."],
      eventsScanned: 0,
    };
  }

  const now = Date.now();
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time),
  );

  const timed = sorted.filter((e) => {
    const live = isLiveGame(e.commence_time, now);
    return timing === "live" ? live : !live;
  });

  const targets = timed.slice(0, MAX_EVENTS);
  if (targets.length === 0) {
    warnings.push(
      timing === "live"
        ? "No in-progress MLB games for props — try Upcoming."
        : "No upcoming MLB games for props — try Live.",
    );
  }

  const savantPlayers = await loadSavantPlayers().catch(() => [] as SavantPlayerRate[]);
  if (savantPlayers.length > 0) {
    warnings.push(
      `Player-level Savant expected stats loaded (${savantPlayers.length} batters) for hit/HR priors.`,
    );
  }

  warnings.push(
    `Scanning up to ${targets.length} MLB games for batter hits, home runs, and 1st-inning totals.`,
  );

  const opportunities: PropOpportunity[] = [];
  let scanned = 0;

  await Promise.all(
    targets.map(async (meta) => {
      const event = await fetchEventOdds("baseball_mlb", meta.id, PROP_MARKETS);
      if (!event || event.bookmakers.length === 0) return;
      scanned += 1;
      const savant = await getSavantMatchup(event.home_team, event.away_team).catch(() => null);
      opportunities.push(...scoreEventProps(event, savant, savantPlayers));
    }),
  );

  if (scanned === 0 && targets.length > 0) {
    warnings.push(
      "Books returned no MLB prop markets for these games yet (props often post closer to first pitch).",
    );
  }

  opportunities.sort((a, b) => b.edgePct - a.edgePct);

  return {
    generatedAt: new Date().toISOString(),
    mode: scanned > 0 ? "live" : "unavailable",
    timing,
    opportunities,
    warnings,
    eventsScanned: scanned,
    oddsQuota: await getOddsQuota(),
  };
}
