import type { EdgeOpportunity } from "./types";

export type CalendarMode = "month" | "week";

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  return addDays(x, -day);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 6x7 month grid starting Sunday of the week that contains the 1st. */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function weekGrid(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
}

export function weekLabel(d: Date): string {
  const days = weekGrid(d);
  const start = days[0];
  const end = days[6];
  const startText = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(start);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${startText} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  const endText = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(end);
  return `${startText} – ${endText}`;
}

export function dayNumber(d: Date): string {
  return String(d.getDate());
}

export function weekdayShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d);
}

export function timeShort(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function teamAbbrev(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  const last = parts[parts.length - 1];
  if (last.length <= 4) return last.toUpperCase();
  return last.slice(0, 3).toUpperCase();
}

export function groupByDay(opps: EdgeOpportunity[]): Map<string, EdgeOpportunity[]> {
  const map = new Map<string, EdgeOpportunity[]>();
  for (const opp of opps) {
    const key = dateKey(new Date(opp.commenceTime));
    const list = map.get(key) ?? [];
    list.push(opp);
    map.set(key, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => {
      if (b.bestEdge !== a.bestEdge) return b.bestEdge - a.bestEdge;
      return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime();
    });
  }
  return map;
}

export function bestEdgeForDay(opps: EdgeOpportunity[]): number {
  if (opps.length === 0) return 0;
  return Math.max(...opps.map((o) => o.bestEdge));
}
