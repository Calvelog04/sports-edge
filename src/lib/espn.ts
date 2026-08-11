import type { EspnEventSummary, InjuryNote, SportKey } from "./types";

const ESPN_SPORT_PATH: Record<SportKey, string> = {
  americanfootball_nfl: "football/nfl",
  basketball_nba: "basketball/nba",
  baseball_mlb: "baseball/mlb",
  icehockey_nhl: "hockey/nhl",
  americanfootball_ncaaf: "football/college-football",
  basketball_ncaab: "basketball/mens-college-basketball",
};

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
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aTokens = new Set(na.split(" "));
  const bTokens = nb.split(" ");
  const overlap = bTokens.filter((t) => aTokens.has(t) && t.length > 2).length;
  return overlap >= 2;
}

export async function fetchEspnScoreboard(
  sport: SportKey,
): Promise<EspnEventSummary[]> {
  const path = ESPN_SPORT_PATH[sport];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Referer: "https://www.espn.com/",
        Origin: "https://www.espn.com",
      },
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) return [];
    const data = JSON.parse(text);
    const events = Array.isArray(data?.events) ? data.events : [];

    return events.map((ev: Record<string, unknown>) => {
      const competition = (ev.competitions as Array<Record<string, unknown>>)?.[0];
      const competitors = (competition?.competitors as Array<Record<string, unknown>>) ?? [];
      const venue = competition?.venue as Record<string, unknown> | undefined;
      const address = venue?.address as Record<string, unknown> | undefined;
      const notes = (competition?.notes as Array<Record<string, unknown>>) ?? [];
      const headlines = notes
        .map((n) => String(n.headline ?? ""))
        .filter(Boolean)
        .slice(0, 3);

      const mappedCompetitors = competitors.map((c) => {
        const team = (c.team as Record<string, unknown>) ?? {};
        return {
          team: {
            id: String(team.id ?? ""),
            displayName: String(team.displayName ?? team.name ?? ""),
            abbreviation: String(team.abbreviation ?? ""),
            logo: typeof team.logo === "string" ? team.logo : undefined,
          },
          homeAway: (c.homeAway === "home" ? "home" : "away") as "home" | "away",
          score: c.score != null ? String(c.score) : undefined,
          records: Array.isArray(c.records)
            ? (c.records as Array<Record<string, unknown>>).map((r) => ({
                type: String(r.type ?? ""),
                summary: String(r.summary ?? ""),
              }))
            : undefined,
        };
      });

      const statusObj = ev.status as Record<string, unknown> | undefined;
      const typeObj = statusObj?.type as Record<string, unknown> | undefined;

      return {
        id: String(ev.id ?? ""),
        name: String(ev.name ?? ""),
        shortName: String(ev.shortName ?? ""),
        status: String(typeObj?.description ?? typeObj?.name ?? "Scheduled"),
        venue: venue?.fullName ? String(venue.fullName) : undefined,
        city: address?.city ? String(address.city) : undefined,
        state: address?.state ? String(address.state) : undefined,
        competitors: mappedCompetitors,
        injuries: [] as InjuryNote[],
        headlines,
      } satisfies EspnEventSummary;
    });
  } catch {
    return [];
  }
}

export async function enrichInjuries(
  sport: SportKey,
  summary: EspnEventSummary,
): Promise<EspnEventSummary> {
  const path = ESPN_SPORT_PATH[sport];
  const injuries: InjuryNote[] = [];

  for (const competitor of summary.competitors) {
    if (!competitor.team.id) continue;
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${competitor.team.id}/injuries`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Referer: "https://www.espn.com/",
          Origin: "https://www.espn.com",
        },
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trimStart().startsWith("<")) continue;
      const data = JSON.parse(text);
      const items = Array.isArray(data?.injuries) ? data.injuries : [];
      for (const item of items.slice(0, 4)) {
        const athlete = item?.athlete?.displayName ?? item?.athlete?.fullName;
        const status = item?.status ?? item?.type?.description ?? "Out";
        if (!athlete) continue;
        injuries.push({
          athlete: String(athlete),
          team: competitor.team.abbreviation || competitor.team.displayName,
          status: String(status),
          detail: item?.longComment ? String(item.longComment).slice(0, 120) : undefined,
        });
      }
    } catch {
      // ignore per-team failures
    }
  }

  return { ...summary, injuries };
}

export function matchEspnEvent(
  events: EspnEventSummary[],
  homeTeam: string,
  awayTeam: string,
): EspnEventSummary | null {
  for (const ev of events) {
    const home = ev.competitors.find((c) => c.homeAway === "home");
    const away = ev.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    if (
      namesMatch(home.team.displayName, homeTeam) &&
      namesMatch(away.team.displayName, awayTeam)
    ) {
      return ev;
    }
  }
  return null;
}
