"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { BestPicksResponse, SportKey } from "@/lib/types";
import { matchesBoardSearch } from "@/lib/board-search";
import { getActiveSportOptions } from "@/lib/odds-client";
import { BestCard } from "./BestCard";
import { BoardIntro } from "./BoardIntro";
import { BoardSearch } from "./BoardSearch";
import { BoardStatus } from "./BoardStatus";
import { SiteNav } from "./SiteNav";
import { SportPicker } from "./SportPicker";
import { TimingSwitch } from "./TimingSwitch";

type SportFilter = SportKey | "all";

export function BestView() {
  const sportFilters = useMemo<Array<{ key: SportFilter; label: string }>>(
    () => [{ key: "all", label: "All" }, ...getActiveSportOptions()],
    [],
  );
  const [sport, setSport] = useState<SportFilter>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<BestPicksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((nextSport: SportFilter) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/best?sport=${nextSport}&timing=upcoming`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setData((await res.json()) as BestPicksResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load best picks");
      }
    });
  }, []);

  useEffect(() => {
    load(sport);
  }, [sport, load]);

  const visible = useMemo(() => {
    const list = data?.picks ?? [];
    return list.filter((p) =>
      matchesBoardSearch(query, p.homeTeam, p.awayTeam, p.selection),
    );
  }, [data, query]);

  const minWin = data ? (data.thresholds.minWinProb * 100).toFixed(0) : "55";
  const minEdge = data ? data.thresholds.minEdgePct.toFixed(1) : "1.5";

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Best · high win% + book edge</p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <TimingSwitch />
          <SportPicker sports={sportFilters} value={sport} onChange={setSport} />
          <button
            type="button"
            className="refresh-btn"
            onClick={() => load(sport)}
            disabled={pending}
          >
            {pending ? "Updating…" : "Refresh view"}
          </button>
        </div>
      </header>

      <BoardIntro board="best" />

      <BoardSearch
        value={query}
        onChange={setQuery}
        placeholder="Search teams…"
        matchCount={visible.length}
        totalCount={data?.picks.length ?? 0}
      />

      <BoardStatus
        pill="BEST"
        countLabel={
          data
            ? `${visible.length} picks · win ≥${minWin}% · edge ≥${minEdge}%`
            : "Loading…"
        }
        generatedAt={data?.generatedAt}
      />

      {error && <p className="error-banner">{error}</p>}

      <section className="results" aria-live="polite">
        {pending && !data && <p className="muted">Loading best picks…</p>}
        {data && data.picks.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No Best picks yet</p>
            <p className="muted">
              Both bars have to clear (win ≥{minWin}% and edge ≥{minEdge}%). Check Suggested or
              Edges.
            </p>
          </div>
        )}
        {data && data.picks.length > 0 && visible.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No matching picks</p>
            <p className="muted">Clear search or try another team name.</p>
          </div>
        )}
        <div className="edge-grid">
          {visible.map((pick) => (
            <BestCard key={pick.id} pick={pick} />
          ))}
        </div>
      </section>
    </div>
  );
}
