import { promises as fs } from "fs";
import path from "path";

export interface SavantPlayerRate {
  playerId: string;
  name: string;
  /** "Last, First" from Savant */
  rawName: string;
  xwoba: number | null;
  woba: number | null;
  barrelPct: number | null;
  /** Rough P(hit in game) prior from season rates */
  hitGamePrior: number | null;
  hrGamePrior: number | null;
}

interface CachePayload {
  fetchedAt: string;
  players: SavantPlayerRate[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "savant-players.json");
const TTL_MS = 12 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let memory: CachePayload | null = null;

function seasonNow(): number {
  const d = new Date();
  return d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Last, First" → "First Last" */
function displayName(raw: string): string {
  if (!raw.includes(",")) return raw.trim();
  const [last, first] = raw.split(",").map((s) => s.trim());
  return `${first} ${last}`.trim();
}

function parseCsv(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, "").replace(/^\?/, "").trim().split(/\r?\n/);
  return lines.map((line) => {
    const cols: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === "," && !q) {
        cols.push(cur);
        cur = "";
      } else cur += c;
    }
    cols.push(cur);
    return cols;
  });
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildPriors(xwoba: number | null, barrel: number | null): {
  hit: number;
  hr: number;
} {
  // Typical starter: ~62% chance of a hit, ~10% HR — scale with xwOBA/barrel
  const x = xwoba ?? 0.32;
  const b = barrel ?? 8;
  const hit = Math.max(0.45, Math.min(0.75, 0.5 + (x - 0.32) * 1.8));
  const hr = Math.max(0.04, Math.min(0.22, 0.07 + (b - 8) * 0.008 + (x - 0.32) * 0.6));
  return { hit, hr };
}

async function fetchExpected(): Promise<SavantPlayerRate[]> {
  const year = seasonNow();
  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=q&csv=true`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "text/csv,*/*", "User-Agent": UA, Referer: "https://baseballsavant.mlb.com/" },
  });
  if (!res.ok) return [];
  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const idx = (name: string) => header.findIndex((h) => h.includes(name));
  const iName = idx("last_name");
  const iId = idx("player_id");
  const iXwoba = header.findIndex((h) => h === "est_woba" || h === "xwoba");
  const iWoba = header.findIndex((h) => h === "woba");
  const out: SavantPlayerRate[] = [];

  for (const row of rows.slice(1)) {
    const rawName = (row[iName] ?? "").replace(/^"|"$/g, "");
    if (!rawName) continue;
    const xwoba = num(row[iXwoba]);
    const woba = num(row[iWoba]);
    const priors = buildPriors(xwoba, null);
    out.push({
      playerId: (row[iId] ?? "").replace(/^"|"$/g, ""),
      name: displayName(rawName),
      rawName,
      xwoba,
      woba,
      barrelPct: null,
      hitGamePrior: priors.hit,
      hrGamePrior: priors.hr,
    });
  }
  return out;
}

async function loadCache(): Promise<CachePayload | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as CachePayload;
  } catch {
    return null;
  }
}

function fresh(c: CachePayload): boolean {
  return Date.now() - Date.parse(c.fetchedAt) < TTL_MS && c.players.length > 50;
}

export async function loadSavantPlayers(force = false): Promise<SavantPlayerRate[]> {
  if (!force && memory && fresh(memory)) return memory.players;
  if (!force) {
    const disk = await loadCache();
    if (disk && fresh(disk)) {
      memory = disk;
      return disk.players;
    }
  }
  const players = await fetchExpected();
  if (players.length === 0) {
    const disk = await loadCache();
    return disk?.players ?? [];
  }
  const payload: CachePayload = { fetchedAt: new Date().toISOString(), players };
  memory = payload;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload), "utf8").catch(() => undefined);
  return players;
}

export function findSavantPlayer(
  players: SavantPlayerRate[],
  query: string,
): SavantPlayerRate | null {
  const nq = normalize(query);
  if (!nq) return null;
  const exact = players.find((p) => normalize(p.name) === nq);
  if (exact) return exact;
  const last = nq.split(" ").pop() ?? "";
  const candidates = players.filter((p) => {
    const pn = normalize(p.name);
    return pn === nq || pn.includes(nq) || nq.includes(pn) || (last.length >= 4 && pn.endsWith(last));
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    return (
      candidates.find((p) => {
        const parts = normalize(p.name).split(" ");
        return parts.every((t) => nq.includes(t) || t.length < 3);
      }) ?? candidates[0]
    );
  }
  return null;
}
