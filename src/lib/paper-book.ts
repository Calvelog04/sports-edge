import { promises as fs } from "fs";
import path from "path";
import type { MarketKey } from "./types";

export interface PaperSignal {
  id: string;
  recordedAt: string;
  eventId: string;
  sport: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  market: MarketKey | string;
  selection: string;
  line?: number;
  modelProb: number;
  /** First seen American price */
  openPrice: number;
  /** Last seen American price before kickoff */
  closePrice: number | null;
  book: string;
  edgePct: number;
  status: "open" | "won" | "lost" | "push" | "void";
  clvPct: number | null;
}

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "paper-book.json");

async function ensure(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(FILE);
  } catch {
    await fs.writeFile(FILE, "[]", "utf8");
  }
}

export async function readPaperBook(): Promise<PaperSignal[]> {
  await ensure();
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as PaperSignal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePaperBook(rows: PaperSignal[]): Promise<void> {
  await ensure();
  await fs.writeFile(FILE, JSON.stringify(rows.slice(0, 2000), null, 2), "utf8");
}

function americanToImplied(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/** Closing line value: positive = beat the close. */
export function computeClvPct(openPrice: number, closePrice: number): number {
  return (americanToImplied(openPrice) - americanToImplied(closePrice)) * 100;
}

export async function upsertPaperSignals(
  signals: Array<Omit<PaperSignal, "id" | "recordedAt" | "closePrice" | "status" | "clvPct"> & {
    closePrice?: number | null;
  }>,
): Promise<void> {
  const book = await readPaperBook();
  const now = new Date().toISOString();
  for (const s of signals) {
    const existing = book.find(
      (b) =>
        b.eventId === s.eventId &&
        b.market === s.market &&
        b.selection === s.selection &&
        b.line === s.line &&
        b.status === "open",
    );
    const kickoff = Date.parse(s.commenceTime);
    const beforeStart = Number.isFinite(kickoff) && Date.now() < kickoff;

    if (existing) {
      if (beforeStart) {
        existing.closePrice = s.openPrice;
        existing.modelProb = s.modelProb;
        existing.edgePct = s.edgePct;
      }
    } else {
      book.unshift({
        id: crypto.randomUUID(),
        recordedAt: now,
        eventId: s.eventId,
        sport: s.sport,
        commenceTime: s.commenceTime,
        homeTeam: s.homeTeam,
        awayTeam: s.awayTeam,
        market: s.market,
        selection: s.selection,
        line: s.line,
        modelProb: s.modelProb,
        openPrice: s.openPrice,
        closePrice: beforeStart ? s.openPrice : null,
        book: s.book,
        edgePct: s.edgePct,
        status: "open",
        clvPct: null,
      });
    }
  }
  await writePaperBook(book);
}

export async function settlePaperAgainstPicks(
  graded: Array<{
    eventId: string;
    market: string;
    selection: string;
    line?: number;
    status: "won" | "lost" | "push" | "void";
  }>,
): Promise<PaperSignal[]> {
  const book = await readPaperBook();
  for (const row of book) {
    if (row.status !== "open") continue;
    const match = graded.find(
      (g) =>
        g.eventId === row.eventId &&
        g.market === row.market &&
        g.selection === row.selection &&
        (g.line == null || g.line === row.line),
    );
    if (!match) continue;
    row.status = match.status;
    if (row.closePrice != null) {
      row.clvPct = computeClvPct(row.openPrice, row.closePrice);
    }
  }
  await writePaperBook(book);
  return book;
}

export function paperPerformance(book: PaperSignal[]) {
  const graded = book.filter((b) => b.status === "won" || b.status === "lost");
  const wins = graded.filter((b) => b.status === "won").length;
  const losses = graded.filter((b) => b.status === "lost").length;
  let brier = 0;
  for (const g of graded) {
    const y = g.status === "won" ? 1 : 0;
    brier += (g.modelProb - y) ** 2;
  }
  const withClv = book.filter((b) => b.clvPct != null);
  const avgClv =
    withClv.length > 0
      ? withClv.reduce((s, b) => s + (b.clvPct ?? 0), 0) / withClv.length
      : null;
  return {
    graded: graded.length,
    wins,
    losses,
    winRate: graded.length ? wins / graded.length : null,
    brier: graded.length ? brier / graded.length : null,
    avgClvPct: avgClv,
    open: book.filter((b) => b.status === "open").length,
  };
}
