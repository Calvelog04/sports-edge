import type { ProbablePitcher, ProbablePitcherMatchup } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

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
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const aTokens = na.split(" ");
  const bTokens = nb.split(" ");
  const overlap = bTokens.filter((t) => aTokens.includes(t) && t.length > 2).length;
  return overlap >= 2;
}

function dateKeysAround(iso: string): string[] {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return [];
  const keys: string[] = [];
  for (const delta of [-1, 0, 1]) {
    const d = new Date(start.getTime() + delta * 24 * 60 * 60 * 1000);
    keys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return [...new Set(keys)];
}

function parsePitcher(raw: Record<string, unknown> | null | undefined): ProbablePitcher | null {
  if (!raw?.fullName && !raw?.id) return null;
  const statsArr = Array.isArray(raw.stats) ? raw.stats : [];
  const season = statsArr.find(
    (s: Record<string, unknown>) =>
      (s.type as { displayName?: string })?.displayName === "statsSingleSeason" &&
      (s.group as { displayName?: string })?.displayName === "pitching",
  ) as { stats?: Record<string, unknown> } | undefined;
  const st = season?.stats ?? {};
  return {
    id: String(raw.id ?? ""),
    fullName: String(raw.fullName ?? ""),
    source: "mlb-statsapi",
    era: num(st.era) ?? undefined,
    wins: num(st.wins) ?? undefined,
    losses: num(st.losses) ?? undefined,
    strikeOuts: num(st.strikeOuts) ?? undefined,
    whip: num(st.whip) ?? undefined,
    inningsPitched: st.inningsPitched != null ? String(st.inningsPitched) : undefined,
  };
}

/** ERA → rough win lean for the pitcher's team (lower ERA = better). */
export function pitcherStrength(p: ProbablePitcher | null | undefined): number {
  if (!p?.era || !Number.isFinite(p.era)) return 0.5;
  // League-ish ERA ~4.2; map 2.5→0.68, 5.5→0.32
  return Math.max(0.28, Math.min(0.72, 0.5 + (4.2 - p.era) * 0.07));
}

export function pitcherMatchupLean(matchup: ProbablePitcherMatchup | null): number | null {
  if (!matchup?.home && !matchup?.away) return null;
  const h = pitcherStrength(matchup.home);
  const a = pitcherStrength(matchup.away);
  const raw = h / (h + a || 1);
  return Math.max(0.34, Math.min(0.66, raw));
}

let cache: { at: number; byKey: Map<string, ProbablePitcherMatchup> } | null = null;
const CACHE_MS = 30 * 60 * 1000;

async function loadDay(date: string): Promise<ProbablePitcherMatchup[]> {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,stats,team`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    dates?: Array<{
      games?: Array<{
        gamePk: number;
        teams?: {
          home?: { team?: { name?: string }; probablePitcher?: Record<string, unknown> };
          away?: { team?: { name?: string }; probablePitcher?: Record<string, unknown> };
        };
      }>;
    }>;
  };
  const out: ProbablePitcherMatchup[] = [];
  for (const g of data.dates?.[0]?.games ?? []) {
    out.push({
      gamePk: g.gamePk,
      homeTeam: String(g.teams?.home?.team?.name ?? ""),
      awayTeam: String(g.teams?.away?.team?.name ?? ""),
      home: parsePitcher(g.teams?.home?.probablePitcher),
      away: parsePitcher(g.teams?.away?.probablePitcher),
    });
  }
  return out;
}

export async function getPitcherMatchup(
  homeTeam: string,
  awayTeam: string,
  commenceTime: string,
): Promise<ProbablePitcherMatchup | null> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), byKey: new Map() };
    for (const d of dateKeysAround(commenceTime)) {
      const rows = await loadDay(d).catch(() => []);
      for (const row of rows) {
        cache.byKey.set(`${normalize(row.homeTeam)}::${normalize(row.awayTeam)}`, row);
      }
    }
  }

  const exact = cache.byKey.get(`${normalize(homeTeam)}::${normalize(awayTeam)}`);
  if (exact) return exact;

  for (const row of cache.byKey.values()) {
    if (namesMatch(row.homeTeam, homeTeam) && namesMatch(row.awayTeam, awayTeam)) return row;
  }
  return null;
}

export function pitcherSummaryLine(m: ProbablePitcherMatchup | null | undefined): string | null {
  if (!m?.home && !m?.away) return null;
  const bits: string[] = [];
  if (m.away) {
    bits.push(
      `${m.away.fullName}${m.away.era != null ? ` ${m.away.era.toFixed(2)} ERA` : ""}`,
    );
  }
  if (m.home) {
    bits.push(
      `${m.home.fullName}${m.home.era != null ? ` ${m.home.era.toFixed(2)} ERA` : ""}`,
    );
  }
  return `Probables: ${bits.join(" vs ")}`;
}
