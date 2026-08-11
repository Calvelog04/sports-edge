"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  addDays,
  bestEdgeForDay,
  dateKey,
  dayNumber,
  groupByDay,
  monthGrid,
  monthLabel,
  sameDay,
  startOfMonth,
  teamAbbrev,
  timeShort,
  weekGrid,
  weekLabel,
  weekdayShort,
  type CalendarMode,
} from "@/lib/calendar";
import { formatAmerican, formatEdge, marketLabel } from "@/lib/format";
import { SPORT_OPTIONS } from "@/lib/odds-client";
import type { GameTiming } from "@/lib/timing";
import type { EdgeOpportunity, OddsQuotaInfo, SportKey } from "@/lib/types";
import { OddsQuotaLabel } from "./OddsQuotaLabel";
import { SiteNav } from "./SiteNav";
import { SportPicker } from "./SportPicker";
import { TimingSwitch } from "./TimingSwitch";

type CalendarPayload = {
  generatedAt: string;
  mode: "live" | "unavailable";
  timing: GameTiming;
  opportunities: EdgeOpportunity[];
  warnings: string[];
  sports: SportKey[];
  oddsQuota?: OddsQuotaInfo;
};

type SportFilter = SportKey | "all";

const FILTER_SPORTS: Array<{ key: SportFilter; label: string }> = [
  { key: "all", label: "All" },
  ...SPORT_OPTIONS,
];

export function CalendarView() {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [sport, setSport] = useState<SportFilter>("all");
  const [timing, setTiming] = useState<GameTiming>("upcoming");
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const now = new Date();
    setAnchor(startOfMonth(now));
    setSelectedDay(dateKey(now));
  }, []);

  const load = useCallback((filter: SportFilter, nextTiming: GameTiming) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(
          `/api/calendar?sport=${filter}&timing=${nextTiming}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        const json = (await res.json()) as CalendarPayload;
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load calendar");
      }
    });
  }, []);

  useEffect(() => {
    load(sport, timing);
  }, [sport, timing, load]);

  const byDay = useMemo(
    () => groupByDay(data?.opportunities ?? []),
    [data?.opportunities],
  );

  const safeAnchor = anchor ?? startOfMonth(new Date(0));

  const days = useMemo(
    () => (mode === "month" ? monthGrid(safeAnchor) : weekGrid(safeAnchor)),
    [mode, safeAnchor],
  );

  const now = new Date();
  const selectedOpps = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  function shift(dir: -1 | 1) {
    if (!anchor) return;
    if (mode === "month") {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    } else {
      setAnchor(addDays(anchor, dir * 7));
    }
  }

  function goToday() {
    const t = new Date();
    setAnchor(mode === "month" ? startOfMonth(t) : t);
    setSelectedDay(dateKey(t));
  }

  if (!anchor) {
    return (
      <div className="dashboard calendar-page">
        <header className="topbar">
          <div className="brand-block">
            <p className="brand">MintPicks</p>
            <p className="tagline">Live pro edges on the calendar</p>
            <SiteNav />
          </div>
        </header>
        <p className="muted">Loading calendar…</p>
      </div>
    );
  }

  return (
    <div className="dashboard calendar-page">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
            <p className="tagline">Live pro edges on the calendar</p>
          <SiteNav />
        </div>
        <div className="calendar-controls">
          <div className="view-toggle" role="tablist" aria-label="Calendar view">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "month"}
              className={mode === "month" ? "view-chip active" : "view-chip"}
              onClick={() => {
                setMode("month");
                setAnchor(startOfMonth(selectedDay ? new Date(`${selectedDay}T12:00:00`) : new Date()));
              }}
            >
              Month
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "week"}
              className={mode === "week" ? "view-chip active" : "view-chip"}
              onClick={() => {
                setMode("week");
                setAnchor(selectedDay ? new Date(`${selectedDay}T12:00:00`) : new Date());
              }}
            >
              Week
            </button>
          </div>
          <div className="range-nav">
            <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous">
              ‹
            </button>
            <button type="button" className="today-btn" onClick={goToday}>
              Today
            </button>
            <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Next">
              ›
            </button>
          </div>
          <p className="range-label">{mode === "month" ? monthLabel(anchor) : weekLabel(anchor)}</p>
        </div>
      </header>

      <div className="calendar-toolbar">
        <TimingSwitch value={timing} onChange={setTiming} />
        <SportPicker sports={FILTER_SPORTS} value={sport} onChange={setSport} />
        <button
          type="button"
          className="refresh-btn"
          onClick={() => load(sport, timing)}
          disabled={pending}
        >
          {pending ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {data && (
        <div className={`status-banner ${data.mode}`}>
          <div>
            <span className="mode-pill">
              {data.mode === "live" ? "LIVE ODDS" : "NO LIVE ODDS"}
            </span>
            <span className="meta">
              {data.opportunities.length}{" "}
              {data.timing === "live" ? "in-play" : "upcoming"} games with edge · ranked by
              best model edge
              {" · "}
              <OddsQuotaLabel quota={data.oddsQuota} />
            </span>
          </div>
        </div>
      )}
      {error && <p className="error-banner">{error}</p>}

      {data && data.mode === "unavailable" && data.opportunities.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">No live odds yet</p>
          <p className="muted">
            Demo games are turned off. Add <code>ODDS_API_KEY</code> to{" "}
            <code>.env.local</code> from{" "}
            <a href="https://the-odds-api.com" target="_blank" rel="noreferrer">
              the-odds-api.com
            </a>
            , restart the server, then only real upcoming games will show.
          </p>
        </div>
      )}
      <div className={`cal-grid ${mode}`}>
        {(mode === "month"
          ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
          : days.map(weekdayShort)
        ).map((label, i) => (
          <div key={`${label}-${i}`} className="cal-dow">
            {mode === "week" ? (
              <>
                <span>{label}</span>
                <strong>{dayNumber(days[i])}</strong>
              </>
            ) : (
              label
            )}
          </div>
        ))}

        {days.map((day) => {
          const key = dateKey(day);
          const opps = byDay.get(key) ?? [];
          const best = bestEdgeForDay(opps);
          const inMonth = day.getMonth() === anchor.getMonth();
          const isToday = sameDay(day, now);
          const isSelected = selectedDay === key;
          const heat =
            best >= 5 ? "hot" : best >= 3 ? "warm" : opps.length > 0 ? "cool" : "";

          return (
            <button
              key={key}
              type="button"
              className={[
                "cal-cell",
                mode,
                !inMonth && mode === "month" ? "outside" : "",
                isToday ? "today" : "",
                isSelected ? "selected" : "",
                heat,
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setSelectedDay(key)}
            >
              {mode === "month" && <span className="cal-daynum">{dayNumber(day)}</span>}
              <div className="cal-events">
                {opps.slice(0, mode === "week" ? 8 : 3).map((opp) => {
                  const top = opp.signals[0];
                  return (
                    <div key={opp.eventId} className="cal-event">
                      <span className="cal-edge">{formatEdge(opp.bestEdge)}</span>
                      <span className="cal-match">
                        {teamAbbrev(opp.awayTeam)}@{teamAbbrev(opp.homeTeam)}
                      </span>
                      {mode === "week" && top && (
                        <span className="cal-pick">
                          {timeShort(opp.commenceTime)} · {marketLabel(top.market)}{" "}
                          {formatAmerican(top.bestPrice)} {top.bestBook}
                        </span>
                      )}
                    </div>
                  );
                })}
                {opps.length > (mode === "week" ? 8 : 3) && (
                  <span className="cal-more">+{opps.length - (mode === "week" ? 8 : 3)} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <section className="day-panel" aria-live="polite">
        <h2 className="day-panel-title">
          {selectedDay
            ? new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              }).format(new Date(`${selectedDay}T12:00:00`))
            : "Select a day"}
        </h2>
        {!selectedDay && (
          <p className="muted">Click a day to see ranked edges and best book prices.</p>
        )}
        {selectedDay && selectedOpps.length === 0 && (
          <p className="muted">No +EV games on this day.</p>
        )}
        <ul className="day-edge-list">
          {selectedOpps.map((opp) => {
            const top = opp.signals[0];
            return (
              <li key={opp.eventId} className="day-edge-item">
                <div className="day-edge-main">
                  <div>
                    <p className="day-sport">{opp.sportTitle}</p>
                    <p className="matchup">
                      {opp.awayTeam} <span className="at">@</span> {opp.homeTeam}
                    </p>
                    <p className="kickoff">{timeShort(opp.commenceTime)}</p>
                  </div>
                  <div className="edge-score">
                    <span className="edge-value">{formatEdge(opp.bestEdge)}</span>
                    <span className="edge-label">model edge</span>
                  </div>
                </div>
                {top && (
                  <p className="pick-meta">
                    {marketLabel(top.market)} · {top.selection}
                    {top.line != null ? ` ${top.line > 0 ? "+" : ""}${top.line}` : ""} ·{" "}
                    {formatAmerican(top.bestPrice)} at {top.bestBook} · EV {formatEdge(top.evPct)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
