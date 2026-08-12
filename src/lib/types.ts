export type SportKey =
  | "americanfootball_nfl"
  | "basketball_nba"
  | "baseball_mlb"
  | "icehockey_nhl"
  | "americanfootball_ncaaf"
  | "basketball_ncaab";

export type CoreMarketKey = "h2h" | "spreads" | "totals";

export type PropMarketKey =
  | "batter_hits"
  | "batter_home_runs"
  | "totals_1st_1_innings";

export type MarketKey = CoreMarketKey | PropMarketKey;

export interface ModelWeights {
  elo: number;
  form: number;
  history: number;
  savant: number;
  market: number;
  pitcher: number;
}

export const PROP_MARKET_KEYS: PropMarketKey[] = [
  "batter_hits",
  "batter_home_runs",
  "totals_1st_1_innings",
];

export function isPropMarket(market: string): market is PropMarketKey {
  return (PROP_MARKET_KEYS as string[]).includes(market);
}

export type BookmakerKey =
  | "fanduel"
  | "draftkings"
  | "betmgm"
  | "caesars"
  | "betrivers"
  | "williamhill_us"
  | "pointsbetus"
  | "bovada"
  | "betonlineag"
  | "mybookieag";

export interface Outcome {
  name: string;
  price: number;
  point?: number;
  /** Player name on prop markets */
  description?: string;
}

export interface Market {
  key: string;
  last_update: string;
  outcomes: Outcome[];
}

export interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: Market[];
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
  /** ESPN / derived phase for live vs upcoming boards. */
  gamePhase?: "scheduled" | "in_progress" | "final";
}

export interface EspnCompetitor {
  team: {
    id: string;
    displayName: string;
    abbreviation: string;
    logo?: string;
  };
  homeAway: "home" | "away";
  score?: string;
  records?: Array<{ type: string; summary: string }>;
}

export interface EspnEventSummary {
  id: string;
  name: string;
  shortName: string;
  status: string;
  venue?: string;
  city?: string;
  state?: string;
  competitors: EspnCompetitor[];
  injuries: InjuryNote[];
  headlines: string[];
}

export interface ProbablePitcher {
  id: string;
  fullName: string;
  source: "espn" | "mlb-statsapi";
  era?: number;
  wins?: number;
  losses?: number;
  strikeOuts?: number;
  whip?: number;
  inningsPitched?: string;
}

export interface ProbablePitcherMatchup {
  gamePk?: number;
  homeTeam: string;
  awayTeam: string;
  home: ProbablePitcher | null;
  away: ProbablePitcher | null;
}

export interface RestTravelContext {
  homeDaysRest: number | null;
  awayDaysRest: number | null;
  /** Positive favors home (fresher / less travel disadvantage) */
  homeWinLean: number | null;
  note: string | null;
}


export interface InjuryNote {
  athlete: string;
  team: string;
  status: string;
  detail?: string;
}

export interface WeatherSnapshot {
  location: string;
  tempF: number;
  windMph: number;
  precipChance: number;
  condition: string;
  outdoorRelevant: boolean;
  source?: "weather-underground" | "open-meteo" | "openweather" | "indoor";
  humidity?: number;
  feelsLikeF?: number;
}

export interface PlayerHistoryStat {
  athleteId: string;
  name: string;
  position?: string;
  seasonLabel: string;
  highlights: string[];
}

export interface TeamHistoryProfile {
  teamId: string;
  displayName: string;
  abbreviation: string;
  seasonRecord?: string;
  standingSummary?: string;
  city?: string;
  state?: string;
  recentSeasons: Array<{
    season: string;
    wins: number;
    losses: number;
    ties?: number;
    winPct: number;
  }>;
  historicalWinPct: number | null;
  leaders: PlayerHistoryStat[];
}

export interface MatchHistoryContext {
  home: TeamHistoryProfile | null;
  away: TeamHistoryProfile | null;
}

/** Team row from Baseball Savant league Statcast tables. */
export interface SavantTeamStatcast {
  teamId: string;
  teamName: string;
  teamAbbrev: string;
  league?: string;
  pa?: number;
  ba: number | null;
  obp: number | null;
  slg: number | null;
  woba: number | null;
  xwoba: number | null;
  xba: number | null;
  xslg: number | null;
  barrelPct: number | null;
  hardHitPct: number | null;
  exitVelo: number | null;
  launchAngle: number | null;
  kPct: number | null;
  bbPct: number | null;
  whiffPct: number | null;
  /** 0–1 league percentile (higher = better for that side) */
  rankXwoba: number | null;
  rankWoba: number | null;
  rankBarrel: number | null;
  rankHardHit: number | null;
  rankExitVelo: number | null;
}

export interface SavantMatchupContext {
  season: number;
  sourceUrl: string;
  home: {
    hitting: SavantTeamStatcast | null;
    pitching: SavantTeamStatcast | null;
  };
  away: {
    hitting: SavantTeamStatcast | null;
    pitching: SavantTeamStatcast | null;
  };
  /** Model prior for home win from Statcast offense/staff quality */
  homeWinLean: number;
  /** Additive lean toward Over from run environment (−0.08…0.08) */
  totalOverLean: number;
}

export interface ModelSignal {
  market: MarketKey;
  selection: string;
  line?: number;
  modelProb: number;
  bookImpliedProb: number;
  bestBook: string;
  bestPrice: number;
  edgePct: number;
  evPct: number;
  confidence: number;
  rationale: string[];
}

export interface EdgeOpportunity {
  eventId: string;
  sport: string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  gamePhase?: "scheduled" | "in_progress" | "final";
  weather?: WeatherSnapshot | null;
  espn?: EspnEventSummary | null;
  history?: MatchHistoryContext | null;
  savant?: SavantMatchupContext | null;
  pitchers?: ProbablePitcherMatchup | null;
  restTravel?: RestTravelContext | null;
  signals: ModelSignal[];
  bestEdge: number;
  /** Fractional Kelly stake as % of bankroll (0–1 scale shown as %). */
  kellyPct?: number;
  bookOdds: Array<{
    book: string;
    market: string;
    selection: string;
    price: number;
    point?: number;
  }>;
}

/** Scored MLB prop opportunity (hits, HRs, 1st-inning totals). */
export interface PropOpportunity {
  id: string;
  eventId: string;
  sport: "baseball_mlb";
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  market: PropMarketKey;
  /** Display category for filters */
  category: "hit" | "home_run" | "first_inning";
  player?: string;
  selection: string;
  line?: number;
  bestBook: string;
  bestPrice: number;
  bookImpliedProb: number;
  modelProb: number;
  edgePct: number;
  evPct: number;
  confidence: number;
  rationale: string[];
  label: string;
}

export interface OddsQuotaInfo {
  remaining: number | null;
  used: number | null;
  last: number | null;
  updatedAt: string | null;
  activeKeySlot?: number | null;
  keyCount?: number;
}

export interface PropsResponse {
  generatedAt: string;
  mode: "live" | "unavailable";
  timing: "live" | "upcoming";
  opportunities: PropOpportunity[];
  warnings: string[];
  eventsScanned: number;
  oddsQuota?: OddsQuotaInfo;
  /** True when the current props slot was served from disk cache. */
  boardCached?: boolean;
}

export interface EdgesResponse {
  generatedAt: string;
  mode: "live" | "unavailable";
  timing: "live" | "upcoming";
  sport: SportKey;
  opportunities: EdgeOpportunity[];
  warnings: string[];
  oddsQuota?: OddsQuotaInfo;
  /** True when this response reused the in-memory shared slate. */
  slateCached?: boolean;
  /** Model min edge used when tightening the wide slate for Edges. */
  edgeMinPct?: number;
  /** Odds line source for status UI. */
  linesSource?: "odds-api" | "parlay" | "sportsgameodds" | "espn";
  /** True when underlying odds provider served from its schedule/disk cache. */
  linesCached?: boolean;
}

/** Model's highest-confidence win lean (moneyline) for a game. */
export interface SuggestedPick {
  id: string;
  eventId: string;
  sport: string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  market: "h2h";
  selection: string;
  modelProb: number;
  bookImpliedProb: number;
  bestBook: string;
  bestPrice: number;
  edgePct: number;
  evPct: number;
  confidence: number;
  rationale: string[];
  rank: number;
}

export interface SuggestionsResponse {
  generatedAt: string;
  mode: "live" | "unavailable";
  timing: "live" | "upcoming";
  sport: SportKey | "all";
  suggestions: SuggestedPick[];
  warnings: string[];
  oddsQuota?: OddsQuotaInfo;
}

/** High model win% AND positive sportsbook edge. */
export interface BestPick {
  id: string;
  eventId: string;
  sport: string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  market: MarketKey;
  selection: string;
  line?: number;
  modelProb: number;
  bookImpliedProb: number;
  bestBook: string;
  bestPrice: number;
  edgePct: number;
  evPct: number;
  confidence: number;
  rationale: string[];
  rank: number;
  /** Combined ranking score (win% + edge). */
  blendScore: number;
}

export interface BestPicksResponse {
  generatedAt: string;
  mode: "live" | "unavailable";
  timing: "live" | "upcoming";
  sport: SportKey | "all";
  picks: BestPick[];
  warnings: string[];
  thresholds: { minWinProb: number; minEdgePct: number };
  oddsQuota?: OddsQuotaInfo;
}
