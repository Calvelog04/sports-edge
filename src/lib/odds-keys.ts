import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "odds-keys-state.json");

export interface OddsKeysState {
  activeIndex: number;
  /** Key indices marked out of credits until process restart / manual clear. */
  exhausted: number[];
  updatedAt: string | null;
}

let state: OddsKeysState = {
  activeIndex: 0,
  exhausted: [],
  updatedAt: null,
};
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<OddsKeysState>;
    state = {
      activeIndex: Number.isFinite(parsed.activeIndex) ? Number(parsed.activeIndex) : 0,
      exhausted: Array.isArray(parsed.exhausted)
        ? parsed.exhausted.filter((n) => Number.isFinite(n)).map(Number)
        : [],
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    // fresh
  }
}

async function persist(): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => undefined);
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8").catch(() => undefined);
}

/** Collect ODDS_API_KEY, comma-separated values, and ODDS_API_KEY_2…_10. */
export function listOddsApiKeys(): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(",")) {
      const k = part.trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      keys.push(k);
    }
  };

  push(process.env.ODDS_API_KEY);
  for (let i = 2; i <= 10; i++) {
    push(process.env[`ODDS_API_KEY_${i}`]);
  }
  return keys;
}

export function hasOddsApiKey(): boolean {
  return listOddsApiKeys().length > 0;
}

export function maskOddsKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export async function getOddsKeysState(): Promise<OddsKeysState & { keyCount: number }> {
  await ensureLoaded();
  const keyCount = listOddsApiKeys().length;
  let activeIndex = state.activeIndex;
  if (keyCount > 0) {
    activeIndex = ((activeIndex % keyCount) + keyCount) % keyCount;
  } else {
    activeIndex = 0;
  }
  return {
    activeIndex,
    exhausted: state.exhausted.filter((i) => i >= 0 && i < keyCount),
    updatedAt: state.updatedAt,
    keyCount,
  };
}

export async function setActiveKeyIndex(index: number): Promise<void> {
  await ensureLoaded();
  const keys = listOddsApiKeys();
  if (keys.length === 0) return;
  const next = ((index % keys.length) + keys.length) % keys.length;
  state.activeIndex = next;
  state.exhausted = state.exhausted.filter((i) => i !== next);
  await persist();
}

export async function markKeyExhausted(index: number): Promise<void> {
  await ensureLoaded();
  const keys = listOddsApiKeys();
  if (keys.length === 0) return;
  const idx = ((index % keys.length) + keys.length) % keys.length;
  if (!state.exhausted.includes(idx)) {
    state.exhausted = [...state.exhausted, idx];
  }
  // Advance to the next non-exhausted key when possible
  for (let step = 1; step <= keys.length; step++) {
    const candidate = (idx + step) % keys.length;
    if (!state.exhausted.includes(candidate)) {
      state.activeIndex = candidate;
      await persist();
      return;
    }
  }
  state.activeIndex = (idx + 1) % keys.length;
  await persist();
}

export function isQuotaFailure(status: number, body: string): boolean {
  const lower = body.toLowerCase();
  // Invalid keys are not "out of credits" — skip them without treating as quota.
  if (lower.includes("invalid_key") || lower.includes("api key is not valid")) {
    return false;
  }
  if (status === 401 || status === 402 || status === 429) return true;
  return (
    lower.includes("out_of_usage") ||
    lower.includes("out of usage") ||
    lower.includes("quota") ||
    lower.includes("usage credits") ||
    lower.includes("exceeded")
  );
}
