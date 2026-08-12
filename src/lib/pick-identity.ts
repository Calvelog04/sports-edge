/** Stable identity for a wager — ignores edge % and model win %. */

export type PickIdentity = {
  eventId: string;
  market: string;
  selection: string;
  line?: number | null;
  player?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  /** Kickoff ISO — used so series games on different days do not collide. */
  commenceTime?: string | null;
};

/** App slate timezone for game dates (matches ODDS_TIMEZONE default). */
export const GAME_DATE_TZ = "America/Chicago";

export function normalizeEventId(eventId: string): string {
  return String(eventId ?? "")
    .trim()
    .replace(/^espn-/i, "");
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePickSelection(selection: string): string {
  const s = selection.trim();
  if (/\bunder\b/i.test(s) || /^under$/i.test(s)) return "under";
  if (/\bover\b/i.test(s) || /^over$/i.test(s)) return "over";
  return normalizeName(s);
}

function lineKey(line: number | null | undefined): string {
  if (line == null || Number.isNaN(Number(line))) return "";
  return String(Number(line));
}

function playerKey(player: string | null | undefined): string {
  return player?.trim() ? normalizeName(player) : "";
}

/** Calendar day of kickoff in the app slate timezone (YYYY-MM-DD). */
export function gameDateKey(
  iso: string | null | undefined,
  timeZone = GAME_DATE_TZ,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const bags = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const y = bags.year;
  const m = bags.month;
  const day = bags.day;
  if (!y || !m || !day) return "";
  return `${y}-${m}-${day}`;
}

/** One or more lookup keys so ESPN vs Odds API event ids still collide. */
export function pickIdentityKeys(p: PickIdentity): string[] {
  const market = String(p.market ?? "").trim().toLowerCase();
  const selection = normalizePickSelection(p.selection);
  const line = lineKey(p.line);
  const player = playerKey(p.player);
  const day = gameDateKey(p.commenceTime);
  const tail = `${market}|${selection}|${line}|${player}`;

  const keys = [`id:${normalizeEventId(p.eventId)}|${tail}`];
  // Include slate day so Guardians@Tigers on Tue ≠ same bet on Wed in a series.
  if (p.homeTeam && p.awayTeam && day) {
    keys.push(
      `teams:${normalizeName(p.awayTeam)}@${normalizeName(p.homeTeam)}|${day}|${tail}`,
    );
  }
  return keys;
}

export function picksMatch(a: PickIdentity, b: PickIdentity): boolean {
  const aKeys = new Set(pickIdentityKeys(a));
  return pickIdentityKeys(b).some((k) => aKeys.has(k));
}
