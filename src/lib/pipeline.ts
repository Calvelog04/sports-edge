import { syncEloFromScores } from "./elo-sync";
import { enrichInjuries, fetchEspnScoreboard, matchEspnEvent } from "./espn";
import { fetchMatchHistory } from "./espn-history";
import { fractionalKelly } from "./kelly";
import { learnIfNeeded } from "./learn";
import { flattenBookOdds, scoreEvent } from "./model";
import { ODDS_CACHE_TTL_MS, fetchOdds } from "./odds";
import { getOddsQuota, type OddsQuotaSnapshot } from "./odds-quota";
import { upsertPaperSignals } from "./paper-book";
import { getPitcherMatchup } from "./pitchers";
import { readPicks } from "./picks";
import { fetchRestTravel } from "./rest-travel";
import { getSavantMatchup, loadSavantLeague } from "./savant";
import { filterByTiming, type GameTiming } from "./timing";
import type { EdgeOpportunity, EdgesResponse, SportKey } from "./types";
import { fetchWeatherForVenue, hasWeatherUndergroundKey } from "./weather";

/** Wide floor so Best / Suggested / Edges share one scored slate. */
const WIDE_EDGE_FLOOR = -50;

type SlateEntry = {
  at: number;
  value: EdgesResponse;
  inflight?: Promise<EdgesResponse>;
};

const slateCache = new Map<string, SlateEntry>();

function tightenBoard(board: EdgesResponse, minEdge: number): EdgesResponse {
  const opportunities: EdgeOpportunity[] = [];
  for (const opp of board.opportunities) {
    const signals = opp.signals
      .filter((s) => s.edgePct >= minEdge)
      .sort((a, b) => b.edgePct - a.edgePct);
    if (signals.length === 0) continue;
    const top = signals[0]!;
    opportunities.push({
      ...opp,
      signals,
      bestEdge: top.edgePct,
      kellyPct: fractionalKelly({
        modelProb: top.modelProb,
        americanOdds: top.bestPrice,
      }),
    });
  }
  opportunities.sort((a, b) => b.bestEdge - a.bestEdge);

  return {
    ...board,
    generatedAt: new Date().toISOString(),
    opportunities,
  };
}

async function buildWideSlate(
  sport: SportKey,
  timing: GameTiming,
): Promise<EdgesResponse> {
  const warnings: string[] = [];
  const { events, mode, warning, fromCache } = await fetchOdds(sport);
  if (warning) warnings.push(warning);
  if (fromCache) {
    warnings.push(`Odds API cache hit (${ODDS_CACHE_TTL_MS / 1000}s TTL) — no quota spent on this pull.`);
  }

  const eloSync = await syncEloFromScores().catch(() => null);
  if (eloSync && eloSync.updated > 0) {
    warnings.push(`Elo synced from ${eloSync.updated} completed games across leagues.`);
  }

  const picks = await readPicks();
  const learn = await learnIfNeeded(picks);
  const modelState = learn.state;
  if (learn.ran) {
    warnings.push(
      `Self-train — ${learn.learned} graded (picks + paper) updated Elo, weights, calibration.`,
    );
  } else if (modelState.samplesLearned > 0) {
    warnings.push(
      `Learning active · ${modelState.samplesLearned} graded · conviction ${modelState.convictionScale.toFixed(2)} · tune gate ${modelState.minSamplesForWeightTune}.`,
    );
  }

  if (!hasWeatherUndergroundKey()) {
    warnings.push("WU_API_KEY not set — Open-Meteo weather fallback.");
  }

  let savantReady = false;
  if (sport === "baseball_mlb") {
    const league = await loadSavantLeague();
    savantReady = Boolean(league && league.hitting.length >= 20);
    if (savantReady) {
      warnings.push("MLB deepened: Savant Statcast + probable pitchers in the blend.");
    }
  }

  const espnBoard = await fetchEspnScoreboard(sport);
  const opportunities: EdgeOpportunity[] = [];

  const maxEnrich =
    sport === "baseball_mlb" ? Math.min(events.length, 16) : Math.min(events.length, 8);
  const enrichTargets = events.slice(0, maxEnrich);
  const rest = events.slice(maxEnrich);

  async function buildOne(event: (typeof events)[number], enrich: boolean) {
    let espn = matchEspnEvent(espnBoard, event.home_team, event.away_team);
    if (espn && enrich) {
      try {
        espn = await enrichInjuries(sport, espn);
      } catch {
        // keep base summary
      }
    }

    const homeId = espn?.competitors.find((c) => c.homeAway === "home")?.team.id;
    const awayId = espn?.competitors.find((c) => c.homeAway === "away")?.team.id;

    const history = enrich
      ? await fetchMatchHistory(
          sport,
          event.home_team,
          event.away_team,
          homeId,
          awayId,
        ).catch(() => null)
      : null;

    const weather = await fetchWeatherForVenue({
      sport,
      city: espn?.city ?? history?.home?.city,
      state: espn?.state ?? history?.home?.state,
      venue: espn?.venue,
    });

    const savant =
      sport === "baseball_mlb" && savantReady
        ? await getSavantMatchup(event.home_team, event.away_team)
        : null;

    const pitchers =
      sport === "baseball_mlb" && enrich
        ? await getPitcherMatchup(event.home_team, event.away_team, event.commence_time).catch(
            () => null,
          )
        : null;

    const restTravel =
      enrich && sport !== "baseball_mlb"
        ? await fetchRestTravel({
            sport,
            homeTeamId: homeId,
            awayTeamId: awayId,
            commenceTime: event.commence_time,
          }).catch(() => null)
        : null;

    const signals = scoreEvent({
      event,
      espn,
      weather,
      history,
      savant,
      pitchers,
      restTravel,
      modelState,
      edgeFloor: WIDE_EDGE_FLOOR,
    });
    if (signals.length === 0) return null;

    const top = signals[0];
    const kellyPct = top
      ? fractionalKelly({ modelProb: top.modelProb, americanOdds: top.bestPrice })
      : undefined;

    return {
      eventId: event.id,
      sport: event.sport_key,
      sportTitle: event.sport_title,
      commenceTime: event.commence_time,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      weather,
      espn,
      history,
      savant,
      pitchers,
      restTravel,
      signals,
      bestEdge: top?.edgePct ?? 0,
      kellyPct,
      bookOdds: flattenBookOdds(event),
    } satisfies EdgeOpportunity;
  }

  const enriched = await Promise.all(enrichTargets.map((e) => buildOne(e, true)));
  const plain = await Promise.all(rest.map((e) => buildOne(e, false)));

  for (const opp of [...enriched, ...plain]) {
    if (opp) opportunities.push(opp);
  }

  const filtered = filterByTiming(opportunities, timing).sort(
    (a, b) => b.bestEdge - a.bestEdge,
  );

  await upsertPaperSignals(
    filtered.flatMap((opp) =>
      opp.signals
        .filter((s) => s.edgePct >= 1)
        .slice(0, 3)
        .map((s) => ({
          eventId: opp.eventId,
          sport: opp.sport,
          commenceTime: opp.commenceTime,
          homeTeam: opp.homeTeam,
          awayTeam: opp.awayTeam,
          market: s.market,
          selection: s.selection,
          line: s.line,
          modelProb: s.modelProb,
          openPrice: s.bestPrice,
          book: s.bestBook,
          edgePct: s.edgePct,
        })),
    ),
  ).catch(() => undefined);

  if (mode === "live" && filtered.length === 0 && opportunities.length > 0) {
    warnings.push(
      timing === "live"
        ? "No in-progress games with edges right now — try Upcoming."
        : "No upcoming games with edges right now — try Live.",
    );
  }

  const quota = await getOddsQuota();

  return {
    generatedAt: new Date().toISOString(),
    mode,
    timing,
    sport,
    opportunities: filtered,
    warnings,
    oddsQuota: quota,
    slateCached: false,
    edgeMinPct: modelState.edgeMinPct,
  };
}

async function getSharedSlate(
  sport: SportKey,
  timing: GameTiming,
): Promise<EdgesResponse> {
  const key = `${sport}|${timing}`;
  const hit = slateCache.get(key);
  if (hit?.inflight) return hit.inflight;
  if (hit && Date.now() - hit.at <= ODDS_CACHE_TTL_MS) {
    return {
      ...hit.value,
      slateCached: true,
      oddsQuota: await getOddsQuota(),
      warnings: [
        ...hit.value.warnings.filter((w) => !w.startsWith("Shared slate cache")),
        `Shared slate cache hit (${ODDS_CACHE_TTL_MS / 1000}s TTL) — Best/Suggested/Edges reuse one scan.`,
      ],
    };
  }

  const inflight = buildWideSlate(sport, timing)
    .then((value) => {
      slateCache.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      slateCache.delete(key);
      throw err;
    });

  slateCache.set(key, { at: Date.now(), value: undefined as unknown as EdgesResponse, inflight });
  return inflight;
}

export async function buildEdges(
  sport: SportKey,
  timing: GameTiming = "upcoming",
  opts?: { edgeFloor?: number },
): Promise<EdgesResponse> {
  const wide = await getSharedSlate(sport, timing);
  const floor = opts?.edgeFloor;
  // Wide consumers (Suggested) keep the full slate
  if (floor != null && floor <= WIDE_EDGE_FLOOR + 1) {
    return wide;
  }
  const tightenTo = floor ?? wide.edgeMinPct ?? 1.5;
  return tightenBoard(wide, tightenTo);
}

export async function peekOddsQuota(): Promise<OddsQuotaSnapshot> {
  return getOddsQuota();
}
