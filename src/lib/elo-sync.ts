import { promises as fs } from "fs";
import path from "path";
import {
  getTeamElo,
  loadModelState,
  saveModelState,
  teamEloKey,
  type ModelState,
} from "./model-state";
import { getActiveSportOptions } from "./odds-client";
import { fetchScoresForSport, scoreNamesMatch } from "./scores";

const DATA_DIR = path.join(process.cwd(), "data");
const SYNC_META = path.join(DATA_DIR, "elo-sync.json");

function updateElo(
  state: ModelState,
  sport: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number,
  k = 20,
): void {
  const homeElo = getTeamElo(state, sport, homeTeam);
  const awayElo = getTeamElo(state, sport, awayTeam);
  const expectedHome = 1 / (1 + 10 ** (-(homeElo + state.homeAdvantage - awayElo) / 400));
  let actual = 0.5;
  if (homeScore > awayScore) actual = 1;
  else if (homeScore < awayScore) actual = 0;
  const delta = k * (actual - expectedHome);
  state.teamElo[teamEloKey(sport, homeTeam)] = homeElo + delta;
  state.teamElo[teamEloKey(sport, awayTeam)] = awayElo - delta;
}

/**
 * Rebuild team Elo from completed scores (Odds API when available, else ESPN scoreboard).
 * Runs at most once per local day.
 */
export async function syncEloFromScores(force = false): Promise<{
  updated: number;
  state: ModelState;
}> {
  const state = await loadModelState();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const meta = JSON.parse(await fs.readFile(SYNC_META, "utf8")) as { lastSync?: string };
    if (!force && meta.lastSync === today && Object.keys(state.teamElo).length > 0) {
      return { updated: 0, state };
    }
  } catch {
    // continue
  }

  let metaSeen: string[] = [];
  try {
    const meta = JSON.parse(await fs.readFile(SYNC_META, "utf8")) as { seen?: string[] };
    metaSeen = Array.isArray(meta.seen) ? meta.seen.slice(-2000) : [];
  } catch {
    metaSeen = [];
  }
  const seenSet = new Set(metaSeen);

  let updated = 0;
  for (const sport of getActiveSportOptions().map((s) => s.key)) {
    const events = await fetchScoresForSport(sport, 3);
    for (const ev of events) {
      if (!ev.completed || !ev.scores?.length) continue;
      const key = `${ev.sport_key || sport}::${ev.id}`;
      if (seenSet.has(key)) continue;
      const home = ev.scores.find((s) => scoreNamesMatch(s.name, ev.home_team));
      const away = ev.scores.find((s) => scoreNamesMatch(s.name, ev.away_team));
      if (!home || !away) continue;
      const hs = Number(home.score);
      const as = Number(away.score);
      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
      updateElo(state, ev.sport_key || sport, ev.home_team, ev.away_team, hs, as);
      seenSet.add(key);
      updated += 1;
    }
  }

  await saveModelState(state);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    SYNC_META,
    JSON.stringify(
      { lastSync: today, seen: [...seenSet].slice(-2000), updatedAt: new Date().toISOString() },
      null,
      2,
    ),
    "utf8",
  );

  return { updated, state };
}
