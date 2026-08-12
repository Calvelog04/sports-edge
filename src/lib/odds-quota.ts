import { promises as fs } from "fs";
import path from "path";
import { getOddsKeysState } from "./odds-keys";

export interface OddsQuotaSnapshot {
  remaining: number | null;
  used: number | null;
  last: number | null;
  updatedAt: string | null;
  /** 1-based active key slot for UI */
  activeKeySlot: number | null;
  keyCount: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const QUOTA_FILE = path.join(DATA_DIR, "odds-quota.json");

let memory: OddsQuotaSnapshot = {
  remaining: null,
  used: null,
  last: null,
  updatedAt: null,
  activeKeySlot: null,
  keyCount: 0,
};

let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(QUOTA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<OddsQuotaSnapshot>;
    memory = {
      remaining: parsed.remaining ?? null,
      used: parsed.used ?? null,
      last: parsed.last ?? null,
      updatedAt: parsed.updatedAt ?? null,
      activeKeySlot: parsed.activeKeySlot ?? null,
      keyCount: parsed.keyCount ?? 0,
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
export async function recordOddsQuota(
  headers: Headers,
  meta?: { keyIndex?: number; keyCount?: number },
): Promise<OddsQuotaSnapshot> {
  await ensureLoaded();
  const remaining = numHeader(headers, "x-requests-remaining");
  const used = numHeader(headers, "x-requests-used");
  const last = numHeader(headers, "x-requests-last");
  const keysState = await getOddsKeysState();
  const keyCount = meta?.keyCount ?? keysState.keyCount;
  const keyIndex = meta?.keyIndex ?? keysState.activeIndex;
  const activeKeySlot = keyCount > 0 ? keyIndex + 1 : null;

  if (remaining == null && used == null && last == null) {
    memory = {
      ...memory,
      activeKeySlot,
      keyCount,
    };
    return { ...memory };
  }
  memory = {
    remaining: remaining ?? memory.remaining,
    used: used ?? memory.used,
    last: last ?? memory.last,
    updatedAt: new Date().toISOString(),
    activeKeySlot,
    keyCount,
  };
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => undefined);
  await fs.writeFile(QUOTA_FILE, JSON.stringify(memory, null, 2), "utf8").catch(() => undefined);
  return { ...memory };
}

export async function getOddsQuota(): Promise<OddsQuotaSnapshot> {
  await ensureLoaded();
  const keysState = await getOddsKeysState();
  return {
    ...memory,
    activeKeySlot: keysState.keyCount > 0 ? keysState.activeIndex + 1 : memory.activeKeySlot,
    keyCount: keysState.keyCount || memory.keyCount,
  };
}

export function formatOddsQuota(q: OddsQuotaSnapshot | null | undefined): string | null {
  if (!q || q.remaining == null) return null;
  const used = q.used != null ? ` · used ${q.used}` : "";
  const last = q.last != null ? ` · last −${q.last}` : "";
  const slot =
    q.keyCount > 1 && q.activeKeySlot != null
      ? ` · key ${q.activeKeySlot}/${q.keyCount}`
      : "";
  return `Odds API ${q.remaining} left${used}${last}${slot}`;
}
