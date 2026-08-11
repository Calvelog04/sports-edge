import { applyConviction } from "./learn";
import { americanToDecimal, americanToImplied, removeVig } from "./odds";
import {
  defaultModelState,
  edgeMinForMarket,
  weightsForMarket,
  type ModelState,
} from "./model-state";
import { pitcherMatchupLean, pitcherSummaryLine } from "./pitchers";
import type {
  Bookmaker,
  EspnEventSummary,
  MarketKey,
  MatchHistoryContext,
  ModelSignal,
  OddsEvent,
  ProbablePitcherMatchup,
  RestTravelContext,
  SavantMatchupContext,
  WeatherSnapshot,
} from "./types";
import { weatherAdjustments } from "./weather";
import { savantSummaryLine } from "./savant";

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Soft prior — prefer learned Elo when present. */
function teamStrength(
  state: ModelState,
  sport: string,
  team: string,
  eventId: string,
): number {
  const learned = state.teamElo[`${sport}::${team.trim().toLowerCase()}`];
  if (learned != null) return learned;
  return 1500 + (hashSeed(`${eventId}:${team}`) - 0.5) * 120;
}

function eloWinProb(homeElo: number, awayElo: number, homeAdv = 55): number {
  const diff = homeElo + homeAdv - awayElo;
  return 1 / (1 + 10 ** (-diff / 400));
}

function recordWinPct(espn: EspnEventSummary | null | undefined, side: "home" | "away"): number | null {
  const comp = espn?.competitors.find((c) => c.homeAway === side);
  const record = comp?.records?.find((r) => r.type === "total")?.summary;
  if (!record) return null;
  const [w, l] = record.split("-").map((n) => Number(n));
  if (!Number.isFinite(w) || !Number.isFinite(l) || w + l === 0) return null;
  return w / (w + l);
}

function injuryPenalty(espn: EspnEventSummary | null | undefined, side: "home" | "away"): number {
  if (!espn) return 0;
  const team = espn.competitors.find((c) => c.homeAway === side);
  if (!team) return 0;
  const abbr = team.team.abbreviation;
  const outs = espn.injuries.filter(
    (i) =>
      i.team === abbr &&
      /out|doubtful|injured reserve|ir/i.test(i.status),
  ).length;
  return Math.min(0.06, outs * 0.015);
}

function consensusFair(
  bookmakers: Bookmaker[],
  market: MarketKey,
  selectionMatcher: (name: string, point?: number) => boolean,
): { fairProb: number; bestBook: string; bestPrice: number; bestPoint?: number } | null {
  const prices: Array<{ book: string; price: number; point?: number }> = [];

  for (const book of bookmakers) {
    const mkt = book.markets.find((m) => m.key === market);
    if (!mkt) continue;
    for (const o of mkt.outcomes) {
      if (selectionMatcher(o.name, o.point)) {
        prices.push({ book: book.title, price: o.price, point: o.point });
      }
    }
  }

  if (prices.length === 0) return null;

  // Best American price for the bettor (higher positive or closer-to-even negative)
  const best = prices.reduce((a, b) => (a.price > b.price ? a : b));

  // Build de-vigged consensus from books that have full two-way markets
  const fairSamples: number[] = [];
  for (const book of bookmakers) {
    const mkt = book.markets.find((m) => m.key === market);
    if (!mkt || mkt.outcomes.length < 2) continue;

    if (market === "h2h") {
      const match = mkt.outcomes.find((o) => selectionMatcher(o.name, o.point));
      const other = mkt.outcomes.find((o) => o !== match);
      if (!match || !other) continue;
      const [fair] = removeVig(americanToImplied(match.price), americanToImplied(other.price));
      fairSamples.push(fair);
    } else if (market === "spreads") {
      const match = mkt.outcomes.find((o) => selectionMatcher(o.name, o.point));
      const other = mkt.outcomes.find((o) => o !== match);
      if (!match || !other) continue;
      const [fair] = removeVig(americanToImplied(match.price), americanToImplied(other.price));
      fairSamples.push(fair);
    } else if (market === "totals") {
      const match = mkt.outcomes.find((o) => selectionMatcher(o.name, o.point));
      const other = mkt.outcomes.find((o) => o !== match);
      if (!match || !other) continue;
      const [fair] = removeVig(americanToImplied(match.price), americanToImplied(other.price));
      fairSamples.push(fair);
    }
  }

  const fairProb =
    fairSamples.length > 0
      ? fairSamples.reduce((a, b) => a + b, 0) / fairSamples.length
      : americanToImplied(best.price);

  return {
    fairProb,
    bestBook: best.book,
    bestPrice: best.price,
    bestPoint: best.point,
  };
}

function blend(weights: Array<{ p: number; w: number }>): number {
  const totalW = weights.reduce((s, x) => s + x.w, 0);
  if (totalW <= 0) return 0.5;
  return weights.reduce((s, x) => s + x.p * x.w, 0) / totalW;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreEvent(opts: {
  event: OddsEvent;
  espn?: EspnEventSummary | null;
  weather?: WeatherSnapshot | null;
  history?: MatchHistoryContext | null;
  savant?: SavantMatchupContext | null;
  pitchers?: ProbablePitcherMatchup | null;
  restTravel?: RestTravelContext | null;
  modelState?: ModelState | null;
  edgeFloor?: number;
}): ModelSignal[] {
  const { event, espn, weather, history, savant, pitchers, restTravel } = opts;
  const state = opts.modelState ?? defaultModelState();
  const wH2h = weightsForMarket(state, "h2h");
  const signals: ModelSignal[] = [];
  const wx = weatherAdjustments(weather);

  const homeElo = teamStrength(state, event.sport_key, event.home_team, event.id);
  const awayElo = teamStrength(state, event.sport_key, event.away_team, event.id);
  let eloHome = eloWinProb(homeElo, awayElo, state.homeAdvantage);

  const homeRec = recordWinPct(espn, "home");
  const awayRec = recordWinPct(espn, "away");
  let formHome = 0.5;
  if (homeRec != null && awayRec != null) {
    formHome = clamp(homeRec / (homeRec + awayRec || 1), 0.28, 0.72);
  }

  const histHome = history?.home?.historicalWinPct ?? null;
  const histAway = history?.away?.historicalWinPct ?? null;
  let histLean = 0.5;
  if (histHome != null && histAway != null) {
    histLean = clamp(histHome / (histHome + histAway || 1), 0.3, 0.7);
  }

  const savantLean = savant?.homeWinLean ?? null;
  const pitcherLean = pitcherMatchupLean(pitchers ?? null);
  const restLean = restTravel?.homeWinLean ?? null;

  // Independent signal strength → shrink market weight (#2)
  const independentCount =
    (savantLean != null ? 1 : 0) +
    (pitcherLean != null ? 1 : 0) +
    (homeRec != null ? 1 : 0) +
    (histHome != null ? 1 : 0) +
    (restLean != null ? 1 : 0);
  let marketW = wH2h.market;
  if (independentCount >= 3) marketW *= 0.55;
  else if (independentCount >= 2) marketW *= 0.75;

  const savantW = savantLean != null ? wH2h.savant : 0;
  const pitcherW = pitcherLean != null ? wH2h.pitcher : 0;
  const restW = restLean != null ? 0.08 : 0;
  const spare =
    (savantLean == null ? wH2h.savant : 0) +
    (pitcherLean == null ? wH2h.pitcher : 0) +
    (wH2h.market - marketW);
  const histW = wH2h.history + spare * 0.35;
  const formW = wH2h.form + spare * 0.2;
  const eloW = wH2h.elo + spare * 0.25;
  marketW += spare * 0.2;

  eloHome = clamp(eloHome - injuryPenalty(espn, "home") + injuryPenalty(espn, "away"), 0.2, 0.8);

  const mlHome = consensusFair(event.bookmakers, "h2h", (name) => name === event.home_team);
  const mlAway = consensusFair(event.bookmakers, "h2h", (name) => name === event.away_team);

  const savantNote = savantSummaryLine(savant);
  const pitcherNote = pitcherSummaryLine(pitchers);
  const restNote = restTravel?.note ?? null;

  if (mlHome && mlAway) {
    const rawHome = blend([
      { p: eloHome, w: eloW },
      { p: formHome, w: homeRec != null ? formW : formW * 0.25 },
      { p: histLean, w: histHome != null ? histW : histW * 0.25 },
      { p: savantLean ?? 0.5, w: savantW },
      { p: pitcherLean ?? 0.5, w: pitcherW },
      { p: restLean ?? 0.5, w: restW },
      { p: mlHome.fairProb, w: marketW },
    ]);
    const modelHome = applyConviction(rawHome, state.convictionScale);
    const modelAway = 1 - modelHome;

    const learnedNote =
      Object.keys(state.teamElo).length > 0
        ? `Learned Elo H${homeElo.toFixed(0)}/A${awayElo.toFixed(0)} · conviction ${state.convictionScale.toFixed(2)} · ${state.samplesLearned} graded`
        : `Learning on — grades + paper book improve Elo & weights`;

    const extraNotes = [
      ...(savantNote ? [savantNote] : []),
      ...(pitcherNote ? [pitcherNote] : []),
      ...(restNote ? [restNote] : []),
      learnedNote,
    ];

    pushSignal(signals, {
      market: "h2h",
      selection: event.home_team,
      modelProb: modelHome,
      bookImpliedProb: americanToImplied(mlHome.bestPrice),
      bestBook: mlHome.bestBook,
      bestPrice: mlHome.bestPrice,
      rationale: [
        ...buildMlRationale(
          event.home_team,
          modelHome,
          eloHome,
          formHome,
          espn,
          "home",
          history?.home ?? null,
        ),
        ...extraNotes,
      ],
    });

    pushSignal(signals, {
      market: "h2h",
      selection: event.away_team,
      modelProb: modelAway,
      bookImpliedProb: americanToImplied(mlAway.bestPrice),
      bestBook: mlAway.bestBook,
      bestPrice: mlAway.bestPrice,
      rationale: [
        ...buildMlRationale(
          event.away_team,
          modelAway,
          1 - eloHome,
          1 - formHome,
          espn,
          "away",
          history?.away ?? null,
        ),
        ...extraNotes,
      ],
    });
  }

  const leanHome = applyConviction(
    blend([
      { p: eloHome, w: eloW + 0.1 },
      { p: histLean, w: histHome != null ? histW : 0.05 },
      { p: savantLean ?? 0.5, w: savantW > 0 ? savantW : 0.05 },
      { p: pitcherLean ?? 0.5, w: pitcherW > 0 ? pitcherW : 0.05 },
      { p: formHome, w: formW },
    ]),
    state.convictionScale,
  );

  for (const side of [
    { team: event.home_team, lean: leanHome },
    { team: event.away_team, lean: 1 - leanHome },
  ]) {
    const spread = consensusFair(event.bookmakers, "spreads", (name) => name === side.team);
    if (!spread) continue;
    const compressed = applyConviction(
      blend([
        { p: 0.5 + (side.lean - 0.5) * 0.55, w: 0.5 },
        { p: spread.fairProb, w: 0.5 },
      ]),
      state.convictionScale,
    );
    pushSignal(signals, {
      market: "spreads",
      selection: side.team,
      line: spread.bestPoint,
      modelProb: compressed,
      bookImpliedProb: americanToImplied(spread.bestPrice),
      bestBook: spread.bestBook,
      bestPrice: spread.bestPrice,
      rationale: [
        `Spread lean (${(compressed * 100).toFixed(1)}%)`,
        spread.bestPoint != null
          ? `Line ${spread.bestPoint > 0 ? "+" : ""}${spread.bestPoint}`
          : "Main spread",
        ...(pitcherNote ? [pitcherNote] : []),
        `Best price at ${spread.bestBook}`,
      ],
    });
  }

  const over = consensusFair(event.bookmakers, "totals", (name) => /^over$/i.test(name));
  const under = consensusFair(event.bookmakers, "totals", (name) => /^under$/i.test(name));

  if (over && under) {
    let modelUnder = under.fairProb + wx.totalUnderBoost - (savant?.totalOverLean ?? 0);
    // Better pitchers → lean under slightly
    if (pitcherLean != null) {
      const staffQuality =
        ((pitchers?.home?.era != null ? 4.2 - pitchers.home.era : 0) +
          (pitchers?.away?.era != null ? 4.2 - pitchers.away.era : 0)) /
        2;
      modelUnder += clamp(staffQuality * 0.015, -0.03, 0.03);
    }
    modelUnder = applyConviction(clamp(modelUnder, 0.35, 0.65), state.convictionScale);
    const modelOver = 1 - modelUnder;
    const savantTotalNote =
      savant != null
        ? savant.totalOverLean > 0.015
          ? "Savant run environment leans Over"
          : savant.totalOverLean < -0.015
            ? "Savant run environment leans Under"
            : "Savant run environment neutral"
        : null;

    pushSignal(signals, {
      market: "totals",
      selection: "Under",
      line: under.bestPoint,
      modelProb: modelUnder,
      bookImpliedProb: americanToImplied(under.bestPrice),
      bestBook: under.bestBook,
      bestPrice: under.bestPrice,
      rationale: [
        `Fair under ${(under.fairProb * 100).toFixed(1)}%`,
        wx.windNote ?? "No strong weather lean",
        ...(savantTotalNote ? [savantTotalNote] : []),
        ...(pitcherNote ? [pitcherNote] : []),
        `Best under at ${under.bestBook}`,
      ],
    });
    pushSignal(signals, {
      market: "totals",
      selection: "Over",
      line: over.bestPoint,
      modelProb: modelOver,
      bookImpliedProb: americanToImplied(over.bestPrice),
      bestBook: over.bestBook,
      bestPrice: over.bestPrice,
      rationale: [
        `Fair over ${(over.fairProb * 100).toFixed(1)}%`,
        wx.totalUnderBoost > 0 ? "Weather dampens scoring" : "Neutral weather",
        ...(savantTotalNote ? [savantTotalNote] : []),
        `Best over at ${over.bestBook}`,
      ],
    });
  }

  const floor = opts.edgeFloor;
  return signals
    .filter((s) => {
      const min = floor ?? edgeMinForMarket(state, s.market);
      return s.edgePct >= min;
    })
    .sort((a, b) => b.edgePct - a.edgePct);
}

function pushSignal(
  signals: ModelSignal[],
  partial: Omit<ModelSignal, "edgePct" | "evPct" | "confidence"> & {
    rationale: string[];
  },
) {
  const edgePct = (partial.modelProb - partial.bookImpliedProb) * 100;
  const decimal = americanToDecimal(partial.bestPrice);
  const evPct = (partial.modelProb * decimal - 1) * 100;
  const confidence = clamp(
    0.35 + Math.min(0.4, Math.abs(edgePct) / 20) + (partial.rationale.length > 2 ? 0.1 : 0),
    0.3,
    0.92,
  );

  signals.push({
    ...partial,
    edgePct,
    evPct,
    confidence,
  });
}

function buildMlRationale(
  team: string,
  modelProb: number,
  elo: number,
  form: number,
  espn: EspnEventSummary | null | undefined,
  side: "home" | "away",
  history: MatchHistoryContext["home"] | null,
): string[] {
  const notes = [
    `Model win probability ${(modelProb * 100).toFixed(1)}% for ${team}`,
    `Strength prior ${(elo * 100).toFixed(1)}% · form ${(form * 100).toFixed(1)}%`,
  ];

  if (history?.historicalWinPct != null) {
    notes.push(
      `ESPN historical win% ${(history.historicalWinPct * 100).toFixed(1)}%` +
        (history.seasonRecord ? ` · season ${history.seasonRecord}` : ""),
    );
  }
  if (history?.recentSeasons?.length) {
    const last = history.recentSeasons[0];
    notes.push(
      `Last logged season ${last.season}: ${last.wins}-${last.losses} (${(last.winPct * 100).toFixed(0)}%)`,
    );
  }
  if (history?.leaders?.length) {
    const lead = history.leaders[0];
    notes.push(
      `ESPN player form — ${lead.name}${lead.position ? ` (${lead.position})` : ""}: ${lead.highlights.slice(0, 2).join(", ")}`,
    );
  }

  const injuries = espn?.injuries.filter((i) => {
    const abbr = espn.competitors.find((c) => c.homeAway === side)?.team.abbreviation;
    return abbr && i.team === abbr;
  });
  if (injuries && injuries.length > 0) {
    notes.push(
      `Injuries: ${injuries
        .slice(0, 2)
        .map((i) => `${i.athlete} (${i.status})`)
        .join(", ")}`,
    );
  } else if (!history) {
    notes.push("No ESPN history/injury flags loaded");
  }
  return notes;
}

export function flattenBookOdds(event: OddsEvent) {
  const rows: EdgeOpportunityBookRow[] = [];
  for (const book of event.bookmakers) {
    for (const market of book.markets) {
      for (const o of market.outcomes) {
        rows.push({
          book: book.title,
          market: market.key,
          selection: o.name,
          price: o.price,
          point: o.point,
        });
      }
    }
  }
  return rows;
}

type EdgeOpportunityBookRow = {
  book: string;
  market: string;
  selection: string;
  price: number;
  point?: number;
};
