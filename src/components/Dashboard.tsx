"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { EdgesResponse, SportKey } from "@/lib/types";
import { matchesBoardSearch } from "@/lib/board-search";
import { compareByCommenceAsc } from "@/lib/board-sort";
import { getActiveSportOptions } from "@/lib/odds-client";
import type { GameTiming } from "@/lib/timing";
import { BoardIntro } from "./BoardIntro";
import { BoardSearch } from "./BoardSearch";
import { BoardStatus } from "./BoardStatus";
import { EdgeCard } from "./EdgeCard";
import { SiteNav } from "./SiteNav";
import { SportPicker } from "./SportPicker";
import { TimingSwitch } from "./TimingSwitch";

type MarketFilter = "all" | "h2h" | "spreads" | "totals";
type SortMode = "edge" | "kickoff";

export function Dashboard() {
  const sports = useMemo(() => getActiveSportOptions(), []);
  const [sport, setSport] = useState<SportKey>(sports[0]?.key ?? "baseball_mlb");
  const [timing, setTiming] = useState<GameTiming>("upcoming");
  const [market, setMarket] = useState<MarketFilter>("all");
  const [sort, setSort] = useState<SortMode>("kickoff");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<EdgesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((nextSport: SportKey, nextTiming: GameTiming) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(
          `/api/edges?sport=${nextSport}&timing=${nextTiming}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        const json = (await res.json()) as EdgesResponse;
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load edges");
      }
    });
  }, []);

  useEffect(() => {
    load(sport, timing);
  }, [sport, timing, load]);

  const league = sports.find((s) => s.key === sport)?.label ?? sport;

  const visible = useMemo(() => {
    let list = data?.opportunities ?? [];
    if (market !== "all") {
      list = list.filter((o) => o.signals[0]?.market === market);
    }
    list = list.filter((o) =>
      matchesBoardSearch(
        query,
        o.homeTeam,
        o.awayTeam,
        ...o.signals.map((s) => s.selection),
      ),
    );
    if (sort === "kickoff") {
      return [...list].sort(compareByCommenceAsc);
    }
    return [...list].sort((a, b) => b.bestEdge - a.bestEdge);
  }, [data, market, sort, query]);

  const freshness =
    data?.slateCached || data?.linesCached ? "cached" : data ? "fresh" : null;

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">
            {timing === "live"
              ? "Live · ESPN in-play only"
              : "Edges · soft book prices"}
          </p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <TimingSwitch
            value={timing}
            onChange={(t) => {
              setTiming(t);
            }}
          />
          <SportPicker sports={sports} value={sport} onChange={setSport} />
          <button
            type="button"
            className="refresh-btn"
            onClick={() => load(sport, timing)}
            disabled={pending}
          >
            {pending ? "Updating…" : "Refresh view"}
          </button>
        </div>
      </header>

      <BoardIntro board="edges" />

      <BoardSearch
        value={query}
        onChange={setQuery}
        placeholder="Search teams…"
        matchCount={visible.length}
        totalCount={data?.opportunities.length ?? 0}
      />

      {data && (
        <BoardStatus
          pill={timing === "live" ? "LIVE" : "EDGES"}
          kind={timing === "live" ? "live" : "game"}
          countLabel={`${visible.length} ${timing === "live" ? "in-play" : "upcoming"} with edge`}
          generatedAt={data.generatedAt}
          freshness={freshness}
        />
      )}
      {error && <p className="error-banner">{error}</p>}

      <div className="board-filters" role="toolbar" aria-label="Filter and sort">
        <div className="timing-switch" role="tablist" aria-label="Market">
          {(
            [
              ["all", "All"],
              ["h2h", "ML"],
              ["spreads", "Spread"],
              ["totals", "Total"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={market === key ? "timing-chip active" : "timing-chip"}
              onClick={() => setMarket(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="timing-switch" role="tablist" aria-label="Sort">
          <button
            type="button"
            className={sort === "edge" ? "timing-chip active" : "timing-chip"}
            onClick={() => setSort("edge")}
          >
            Sort: edge
          </button>
          <button
            type="button"
            className={sort === "kickoff" ? "timing-chip active" : "timing-chip"}
            onClick={() => setSort("kickoff")}
          >
            Sort: time
          </button>
        </div>
      </div>

      <section className="results" aria-live="polite">
        {pending && !data && <p className="muted">Loading slate…</p>}
        {data && data.mode === "unavailable" && data.opportunities.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No odds available</p>
            <p className="muted">
              {timing === "live"
                ? "No in-play lines right now — switch to Upcoming."
                : "Odds are paused until the next hourly pull, or this league is out of season."}
            </p>
          </div>
        )}
        {data && data.mode === "live" && data.opportunities.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No games with edge</p>
            <p className="muted">
              {timing === "live"
                ? `No in-play ${league} games with book odds right now — try Upcoming.`
                : `No upcoming ${league} games with edge right now. Try another league or Live.`}
            </p>
          </div>
        )}
        {data && data.opportunities.length > 0 && visible.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No picks in this filter</p>
            <p className="muted">
              {query.trim()
                ? "No teams match that search — clear search or try another name."
                : "Switch market filter to All to see the full slate."}
            </p>
          </div>
        )}
        <div className="edge-grid">
          {visible.map((opp) => (
            <EdgeCard key={opp.eventId} opportunity={opp} />
          ))}
        </div>
      </section>
    </div>
  );
}
