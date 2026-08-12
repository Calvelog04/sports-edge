/** Client-safe odds / props pull window helpers (no filesystem). */

/** 12 hourly pulls: 10:00–21:00 local (10am through 9pm). */
export const ODDS_REFRESH_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] as const;

/** Props: noon (paid credits) then 4pm (ESPN refresh). */
export const PROPS_REFRESH_HOURS = [12, 16] as const;

/** @deprecated Use PROPS_REFRESH_HOURS[0] — noon credits pull. */
export const PROPS_REFRESH_HOUR = PROPS_REFRESH_HOURS[0];

export type PropsPullSource = "credits" | "espn";

export const ODDS_TIMEZONE =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_ODDS_TIMEZONE?.trim() ||
      process.env.ODDS_TIMEZONE?.trim())) ||
  "America/Chicago";

export function partsInTz(
  now: Date,
  timeZone = ODDS_TIMEZONE,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bags = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return {
    year: Number(bags.year),
    month: Number(bags.month),
    day: Number(bags.day),
    hour: Number(bags.hour),
    minute: Number(bags.minute),
  };
}

export function isInOddsRefreshWindow(now = new Date(), timeZone = ODDS_TIMEZONE): boolean {
  const { hour } = partsInTz(now, timeZone);
  return (ODDS_REFRESH_HOURS as readonly number[]).includes(hour);
}

export function getOddsRefreshSlotId(
  now = new Date(),
  timeZone = ODDS_TIMEZONE,
): string | null {
  if (!isInOddsRefreshWindow(now, timeZone)) return null;
  const p = partsInTz(now, timeZone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  return `${p.year}-${mm}-${dd}T${hh}`;
}

export function nextOddsRefreshAt(now = new Date(), timeZone = ODDS_TIMEZONE): Date {
  const p = partsInTz(now, timeZone);
  const hours = ODDS_REFRESH_HOURS as readonly number[];

  let dayOffset = 0;
  let nextHour: number | null = null;
  for (const h of hours) {
    if (h > p.hour) {
      nextHour = h;
      break;
    }
  }
  if (nextHour == null) {
    nextHour = hours[0]!;
    dayOffset = 1;
  }

  const minutesAhead =
    dayOffset * 24 * 60 + (nextHour - p.hour) * 60 - p.minute;
  return new Date(now.getTime() + Math.max(minutesAhead, 1) * 60_000);
}

export function formatShortWhen(date: Date, timeZone = ODDS_TIMEZONE): string {
  return date.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatLinesFrom(iso: string, timeZone = ODDS_TIMEZONE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatNextOddsRefresh(now = new Date()): string {
  const when = formatShortWhen(nextOddsRefreshAt(now));
  if (isInOddsRefreshWindow(now)) {
    return `Hourly odds window open (10am–10pm ${ODDS_TIMEZONE}) · next new pull ${when}`;
  }
  return `Odds pulls paused · next at ${when} (${ODDS_TIMEZONE})`;
}

/** Latest props slot hour that has already opened today (12 or 16), or null before noon. */
export function getActivePropsRefreshHour(
  now = new Date(),
  timeZone = ODDS_TIMEZONE,
): number | null {
  const { hour } = partsInTz(now, timeZone);
  let active: number | null = null;
  for (const h of PROPS_REFRESH_HOURS) {
    if (hour >= h) active = h;
  }
  return active;
}

export function getPropsPullSource(
  now = new Date(),
  timeZone = ODDS_TIMEZONE,
): PropsPullSource | null {
  const hour = getActivePropsRefreshHour(now, timeZone);
  if (hour === 16) return "espn";
  if (hour === 12) return "credits";
  return null;
}

export function getPropsRefreshSlotId(
  now = new Date(),
  timeZone = ODDS_TIMEZONE,
): string | null {
  const p = partsInTz(now, timeZone);
  const hour = getActivePropsRefreshHour(now, timeZone);
  if (hour == null) return null;
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  return `${p.year}-${mm}-${dd}T${hh}`;
}

export function nextPropsRefreshAt(now = new Date(), timeZone = ODDS_TIMEZONE): Date {
  const p = partsInTz(now, timeZone);
  for (const h of PROPS_REFRESH_HOURS) {
    if (h > p.hour) {
      const minutesAhead = (h - p.hour) * 60 - p.minute;
      return new Date(now.getTime() + Math.max(minutesAhead, 1) * 60_000);
    }
  }
  const first = PROPS_REFRESH_HOURS[0]!;
  const minutesAhead = (24 - p.hour + first) * 60 - p.minute;
  return new Date(now.getTime() + Math.max(minutesAhead, 1) * 60_000);
}

export function formatNextPropsRefresh(now = new Date()): string {
  const when = formatShortWhen(nextPropsRefreshAt(now));
  const source = getPropsPullSource(now);
  if (source === "credits") {
    return `Props auto · noon credits done · ESPN refresh next ${when} (${ODDS_TIMEZONE})`;
  }
  if (source === "espn") {
    return `Props auto · 4pm ESPN done · next noon credits ${when} (${ODDS_TIMEZONE})`;
  }
  return `Props auto · next noon credits pull ${when} (${ODDS_TIMEZONE})`;
}
