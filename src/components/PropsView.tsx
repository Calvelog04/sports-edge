"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { PropOpportunity, PropsResponse } from "@/lib/types";
import { matchesBoardSearch } from "@/lib/board-search";
import { formatShortWhen, nextPropsRefreshAt } from "@/lib/odds-window";
import { LIVE_PROPS_ENABLED, type GameTiming } from "@/lib/timing";
import { BoardIntro } from "./BoardIntro";
import { BoardSearch } from "./BoardSearch";
import { BoardStatus } from "./BoardStatus";
import { PropCard } from "./PropCard";
import { SiteNav } from "./SiteNav";
import { TimingSwitch } from "./TimingSwitch";

type PropFilter = "all" | "hit" | "home_run" | "first_inning";

export function PropsView() {
  const [timing, setTiming] = useState<GameTiming>("upcoming");
  const [filter, setFilter] = useState<PropFilter>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<PropsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((nextTiming: GameTiming) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/props?timing=${nextTiming}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setData((await res.json()) as PropsResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load props");
      }
    });
  }, []);

  useEffect(() => {
    load(timing);
  }, [timing, load]);

  const visible = useMemo(() => {
    let list = data?.opportunities ?? [];
    if (filter !== "all") list = list.filter((o) => o.category === filter);
    return list.filter((o) =>
      matchesBoardSearch(query, o.homeTeam, o.awayTeam, o.player, o.label, o.selection),
    );
  }, [data, filter, query]);

  const counts = useMemo(() => {
    const list = (data?.opportunities ?? []).filter((o) =>
      matchesBoardSearch(query, o.homeTeam, o.awayTeam, o.player, o.label, o.selection),
    );
    return {
      all: list.length,
      hit: list.filter((o) => o.category === "hit").length,
      home_run: list.filter((o) => o.category === "home_run").length,
      first_inning: list.filter((o) => o.category === "first_inning").length,
    };
  }, [data, query]);

  const lockedUntil = formatShortWhen(nextPropsRefreshAt());
  const isLive = timing === "live";

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">
            {isLive ? "Props · live ESPN" : "Props · daily MLB slate"}
          </p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <TimingSwitch
            value={timing}
            onChange={setTiming}
            enabled={LIVE_PROPS_ENABLED}
            liveTitle="In-play MLB player props via ESPN (hits & HRs)"
          />
          <button
            type="button"
            className="refresh-btn"
            onClick={() => load(timing)}
            disabled={pending}
          >
            {pending ? "Updating…" : isLive ? "Refresh" : "Refresh view"}
          </button>
        </div>
      </header>

      <BoardIntro board="props" />

      <BoardSearch
        value={query}
        onChange={setQuery}
        placeholder="Search players or teams…"
        matchCount={visible.length}
        totalCount={data?.opportunities.length ?? 0}
      />

      {isLive ? (
        <p className="props-lock-banner">
          Live props · ESPN · no credits · refresh anytime
        </p>
      ) : (
        <p className="props-lock-banner">
          Today&apos;s props slate
          {data?.boardCached ? " · cached" : " · loaded"}
          {" · "}
          auto noon credits / 4pm ESPN · next {lockedUntil}
        </p>
      )}

      <BoardStatus
        pill={isLive ? "LIVE PROPS" : data?.mode === "live" ? "PROPS" : "WAITING"}
        kind={isLive ? "live" : "props"}
        countLabel={
          data
            ? `${data.eventsScanned} games · ${visible.length} props · hits & HRs`
            : "Loading…"
        }
        generatedAt={data?.generatedAt}
        freshness={
          isLive
            ? data
              ? "fresh"
              : null
            : data?.boardCached
              ? "cached"
              : data
                ? "fresh"
                : null
        }
      />

      <div className="timing-switch" role="tablist" aria-label="Prop type">
        {(
          [
            ["all", "All"],
            ["hit", "Record a hit"],
            ["home_run", "Home run"],
            ["first_inning", "1st inning O/U"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "timing-chip active" : "timing-chip"}
            onClick={() => setFilter(key)}
          >
            {label}
            {data ? ` (${counts[key]})` : ""}
          </button>
        ))}
      </div>

      {error && <p className="error-banner">{error}</p>}

      <section className="results" aria-live="polite">
        {pending && !data && (
          <p className="muted">
            {isLive ? "Loading live ESPN props…" : "Loading today’s props slate…"}
          </p>
        )}
        {data && visible.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">
              {query.trim()
                ? "No matching props"
                : data.mode === "unavailable"
                  ? isLive
                    ? "No live props right now"
                    : "Props slate not ready"
                  : "No props in this filter"}
            </p>
            <p className="muted">
              {query.trim()
                ? "Clear search or try another player/team name."
                : isLive
                  ? "ESPN hits & HRs for in-play games. Try again once games are underway and books still have prop markets up."
                  : data.mode === "unavailable"
                    ? `Auto props: noon (credits) and 4pm (ESPN). Next opportunity ${lockedUntil}. Hits & HRs when lines are up; 1st-inning needs Odds API.`
                    : "Try All, or wait until books post prop markets closer to first pitch (next refresh at 4pm ESPN or tomorrow noon)."}
            </p>
          </div>
        )}

        <div className="edge-grid">
          {visible.map((opp: PropOpportunity) => (
            <PropCard key={opp.id} opportunity={opp} />
          ))}
        </div>
      </section>
    </div>
  );
}
