import type {
  MatchHistoryContext,
  PlayerHistoryStat,
  SportKey,
  TeamHistoryProfile,
} from "./types";

const ESPN_SITE_PATH: Record<SportKey, string> = {
  americanfootball_nfl: "football/nfl",
  basketball_nba: "basketball/nba",
  baseball_mlb: "baseball/mlb",
  icehockey_nhl: "hockey/nhl",
  americanfootball_ncaaf: "football/college-football",
  basketball_ncaab: "basketball/mens-college-basketball",
};

const ESPN_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Referer: "https://www.espn.com/",
  Origin: "https://www.espn.com",
};

async function espnGet(url: string, attempts = 3): Promise<unknown | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: ESPN_HEADERS });
      if (res.status === 403 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        continue;
      }
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || text.trimStart().startsWith("<")) return null;
      return JSON.parse(text) as unknown;
    } catch {
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  return null;
}

type TeamIndexEntry = {
  id: string;
  displayName: string;
  abbreviation: string;
  shortDisplayName?: string;
};

const teamIndexCache = new Map<SportKey, TeamIndexEntry[]>();

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aTokens = new Set(na.split(" "));
  const overlap = nb.split(" ").filter((t) => aTokens.has(t) && t.length > 2).length;
  return overlap >= 2;
}

export async function getEspnTeamIndex(sport: SportKey): Promise<TeamIndexEntry[]> {
  const cached = teamIndexCache.get(sport);
  if (cached?.length) return cached;

  const path = ESPN_SITE_PATH[sport];
  const data = await espnGet(
    `https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=400`,
  );
  if (!data) {
    console.warn(`[espn-history] team index fetch failed for ${sport} path=${path}`);
  }

  const root = data as {
    sports?: Array<{
      leagues?: Array<{
        teams?: Array<{ team?: Record<string, unknown> } | Record<string, unknown> >;
      }>;
    }>;
  } | null;

  const rawTeams = root?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const cleaned: TeamIndexEntry[] = [];

  for (const row of rawTeams) {
    const t =
      row && typeof row === "object" && "team" in row
        ? ((row as { team?: Record<string, unknown> }).team ?? {})
        : ((row as Record<string, unknown>) ?? {});
    const id = String(t.id ?? "");
    const displayName = String(t.displayName ?? t.name ?? "");
    const abbreviation = String(t.abbreviation ?? "");
    if (!id || !displayName) continue;
    cleaned.push({
      id,
      displayName,
      abbreviation,
      shortDisplayName: t.shortDisplayName ? String(t.shortDisplayName) : undefined,
    });
  }

  if (cleaned.length > 0) teamIndexCache.set(sport, cleaned);
  return cleaned;
}

export async function resolveEspnTeamId(
  sport: SportKey,
  teamName: string,
): Promise<TeamIndexEntry | null> {
  const teams = await getEspnTeamIndex(sport);
  return (
    teams.find(
      (t) =>
        namesMatch(t.displayName, teamName) ||
        namesMatch(t.abbreviation, teamName) ||
        (t.shortDisplayName ? namesMatch(t.shortDisplayName, teamName) : false),
    ) ?? null
  );
}

function parseRecordSummary(summary?: string): { wins: number; losses: number; ties?: number } | null {
  if (!summary) return null;
  const parts = summary.split("-").map((n) => Number(n));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return { wins: parts[0], losses: parts[1], ties: parts[2] };
}

function winPctFromRecord(wins: number, losses: number, ties = 0): number {
  const total = wins + losses + ties;
  if (total <= 0) return 0.5;
  return (wins + ties * 0.5) / total;
}

async function fetchPlayerHighlights(
  sport: SportKey,
  athleteId: string,
  name: string,
  position?: string,
): Promise<PlayerHistoryStat | null> {
  const path = ESPN_SITE_PATH[sport];
  // site.web.api overview includes season stats snapshot
  const overview = (await espnGet(
    `https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${athleteId}/overview`,
  )) as {
    statistics?: {
      splits?: Array<{
        displayName?: string;
        stats?: Array<{ displayName?: string; displayValue?: string }>;
      }>;
    };
    athlete?: { displayName?: string };
  } | null;

  const split = overview?.statistics?.splits?.[0];
  const seasonLabel = String(split?.displayName ?? "Season");
  const highlights =
    split?.stats
      ?.slice(0, 4)
      .map((s) => `${s.displayName}: ${s.displayValue}`)
      .filter((s) => !s.includes("undefined")) ?? [];

  if (highlights.length === 0) {
    // fallback: lightweight site athlete endpoint
    const siteAthlete = (await espnGet(
      `https://site.api.espn.com/apis/site/v2/sports/${path}/athletes/${athleteId}`,
    )) as {
      athlete?: {
        displayName?: string;
        position?: { abbreviation?: string };
        statistics?: {
          splits?: {
            categories?: Array<{
              stats?: Array<{ displayName?: string; displayValue?: string }>;
            }>;
          };
        };
      };
    } | null;

    const cats = siteAthlete?.athlete?.statistics?.splits?.categories ?? [];
    for (const cat of cats) {
      for (const stat of cat.stats ?? []) {
        if (stat.displayName && stat.displayValue) {
          highlights.push(`${stat.displayName}: ${stat.displayValue}`);
        }
        if (highlights.length >= 4) break;
      }
      if (highlights.length >= 4) break;
    }
  }

  if (highlights.length === 0) return null;

  return {
    athleteId,
    name: overview?.athlete?.displayName ?? name,
    position,
    seasonLabel,
    highlights,
  };
}

export async function fetchTeamHistoryProfile(
  sport: SportKey,
  teamName: string,
  knownId?: string,
): Promise<TeamHistoryProfile | null> {
  const path = ESPN_SITE_PATH[sport];
  const resolved = knownId
    ? { id: knownId, displayName: teamName, abbreviation: "" }
    : await resolveEspnTeamId(sport, teamName);
  if (!resolved?.id) return null;

  const teamId = resolved.id;
  const [detail, history, leaders] = await Promise.all([
    espnGet(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}`),
    espnGet(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/history`),
    espnGet(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/leaders`),
  ]);

  const teamObj =
    (detail as { team?: Record<string, unknown> } | null)?.team ??
    ({} as Record<string, unknown>);

  const recordItem = Array.isArray(teamObj.record)
    ? null
    : (teamObj.record as { items?: Array<{ type?: string; summary?: string }> } | undefined)
        ?.items?.find((i) => i.type === "total") ??
      (teamObj.record as { items?: Array<{ summary?: string }> } | undefined)?.items?.[0];

  // ESPN sometimes nests record differently
  let seasonRecord =
    recordItem?.summary ??
    (typeof teamObj.recordSummary === "string" ? teamObj.recordSummary : undefined);

  if (!seasonRecord && Array.isArray((teamObj as { record?: { items?: unknown } }).record?.items)) {
    const items = (teamObj as { record: { items: Array<{ summary?: string; type?: string }> } })
      .record.items;
    seasonRecord = items.find((i) => i.type === "total")?.summary ?? items[0]?.summary;
  }

  const standingSummary =
    typeof teamObj.standingSummary === "string" ? teamObj.standingSummary : undefined;

  const franchise =
    (teamObj.franchise as Record<string, unknown> | undefined) ?? undefined;
  const venue = (teamObj.venue as Record<string, unknown> | undefined) ?? undefined;
  const address = (venue?.address as Record<string, unknown> | undefined) ?? undefined;
  const city =
    (address?.city ? String(address.city) : undefined) ||
    (typeof teamObj.location === "string" ? String(teamObj.location) : undefined) ||
    (franchise?.location ? String(franchise.location) : undefined);
  const state = address?.state ? String(address.state) : undefined;

  const rawHistory =
    (
      history as {
        seasons?: Array<{
          year?: number;
          displayName?: string;
          summary?: string;
          wins?: number;
          losses?: number;
          ties?: number;
          winPercent?: number;
        }>;
      } | null
    )?.seasons ??
    (
      history as {
        items?: Array<{
          season?: { year?: number; displayName?: string };
          record?: string;
          wins?: number;
          losses?: number;
          ties?: number;
          winPercent?: number;
        }>;
      } | null
    )?.items?.map((item) => ({
      year: item.season?.year,
      displayName: item.season?.displayName,
      summary: item.record,
      wins: item.wins,
      losses: item.losses,
      ties: item.ties,
      winPercent: item.winPercent,
    })) ??
    [];

  const historyRows: Array<{
    year?: number;
    displayName?: string;
    summary?: string;
    wins?: number;
    losses?: number;
    ties?: number;
    winPercent?: number;
  }> = rawHistory;

  const recentSeasons = historyRows
    .slice(0, 6)
    .map((row) => {
      const fromSummary = parseRecordSummary(row.summary);
      const wins = Number(row.wins ?? fromSummary?.wins ?? 0);
      const losses = Number(row.losses ?? fromSummary?.losses ?? 0);
      const ties = Number(row.ties ?? fromSummary?.ties ?? 0);
      const season = String(row.displayName ?? row.year ?? "");
      if (!season || wins + losses === 0) return null;
      return {
        season,
        wins,
        losses,
        ties: ties || undefined,
        winPct: Number(row.winPercent ?? winPctFromRecord(wins, losses, ties)),
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  const historicalWinPct =
    recentSeasons.length > 0
      ? recentSeasons.reduce((s, r) => s + r.winPct, 0) / recentSeasons.length
      : (() => {
          const rec = parseRecordSummary(seasonRecord);
          return rec ? winPctFromRecord(rec.wins, rec.losses, rec.ties ?? 0) : null;
        })();

  const leaderCandidates: Array<{ id: string; name: string; position?: string }> = [];
  const leaderCategories =
    (leaders as { leaders?: Array<{ leaders?: Array<Record<string, unknown>> }> } | null)
      ?.leaders ??
    (leaders as { categories?: Array<{ leaders?: Array<Record<string, unknown>> }> } | null)
      ?.categories ??
    [];

  for (const cat of leaderCategories) {
    for (const row of cat.leaders ?? []) {
      const athlete = (row.athlete as Record<string, unknown> | undefined) ?? row;
      const id = String(athlete.id ?? "");
      const name = String(athlete.displayName ?? athlete.fullName ?? "");
      const position = athlete.position
        ? String((athlete.position as { abbreviation?: string }).abbreviation ?? "")
        : undefined;
      if (id && name && !leaderCandidates.some((c) => c.id === id)) {
        leaderCandidates.push({ id, name, position: position || undefined });
      }
      if (leaderCandidates.length >= 3) break;
    }
    if (leaderCandidates.length >= 3) break;
  }

  // If leaders endpoint empty, pull a few roster names
  if (leaderCandidates.length === 0) {
    const roster = (await espnGet(
      `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/roster`,
    )) as {
      athletes?: Array<{
        items?: Array<{
          id?: string | number;
          displayName?: string;
          position?: { abbreviation?: string };
        }>;
      }>;
    } | null;
    const items = roster?.athletes?.flatMap((g) => g.items ?? []) ?? [];
    for (const a of items.slice(0, 3)) {
      if (!a.id || !a.displayName) continue;
      leaderCandidates.push({
        id: String(a.id),
        name: a.displayName,
        position: a.position?.abbreviation,
      });
    }
  }

  const playerStats = (
    await Promise.all(
      leaderCandidates
        .slice(0, 3)
        .map((p) => fetchPlayerHighlights(sport, p.id, p.name, p.position)),
    )
  ).filter((p): p is PlayerHistoryStat => Boolean(p));

  return {
    teamId,
    displayName: String(teamObj.displayName ?? resolved.displayName ?? teamName),
    abbreviation: String(teamObj.abbreviation ?? resolved.abbreviation ?? ""),
    seasonRecord,
    standingSummary,
    city,
    state,
    recentSeasons,
    historicalWinPct,
    leaders: playerStats,
  };
}

export async function fetchMatchHistory(
  sport: SportKey,
  homeTeam: string,
  awayTeam: string,
  homeId?: string,
  awayId?: string,
): Promise<MatchHistoryContext> {
  const [home, away] = await Promise.all([
    fetchTeamHistoryProfile(sport, homeTeam, homeId),
    fetchTeamHistoryProfile(sport, awayTeam, awayId),
  ]);
  return { home, away };
}
