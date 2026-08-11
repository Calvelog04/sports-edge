import { promises as fs } from "fs";
import path from "path";

export interface OddsQuotaSnapshot {
  remaining: number | null;
  used: number | null;
  last: number | null;
  updatedAt: string | null;
}

const DATA_DIR = path.join(process.cwd(), "data");
const QUOTA_FILE = path.join(DATA_DIR, "odds-quota.json");

let memory: OddsQuotaSnapshot = {
  remaining: null,
  used: null,
  last: null,
  updatedAt: null,
};

let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(QUOTA_FILE, "utf8");
    const parsed = JSON.parse(raw) as OddsQuotaSnapshot;
    memory = {
      remaining: parsed.remaining ?? null,
      used: parsed.used ?? null,
      last: parsed.last ?? null,
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    // fresh
  }
}

function numHeader(headers: Headers, name: string): number | null {
  const v = headers.get(name);
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Capture The Odds API usage headers from a response. */
export async function recordOddsQuota(headers: Headers): Promise<OddsQuotaSnapshot> {
  await ensureLoaded();
  const remaining = numHeader(headers, "x-requests-remaining");
  const used = numHeader(headers, "x-requests-used");
  const last = numHeader(headers, "x-requests-last");
  if (remaining == null && used == null && last == null) {
    return { ...memory };
  }
  memory = {
    remaining: remaining ?? memory.remaining,
    used: used ?? memory.used,
    last: last ?? memory.last,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => undefined);
  await fs.writeFile(QUOTA_FILE, JSON.stringify(memory, null, 2), "utf8").catch(() => undefined);
  return { ...memory };
}

export async function getOddsQuota(): Promise<OddsQuotaSnapshot> {
  await ensureLoaded();
  return { ...memory };
}

export function formatOddsQuota(q: OddsQuotaSnapshot | null | undefined): string | null {
  if (!q || q.remaining == null) return null;
  const used = q.used != null ? ` · used ${q.used}` : "";
  const last = q.last != null ? ` · last −${q.last}` : "";
  return `Odds API ${q.remaining} left${used}${last}`;
}
