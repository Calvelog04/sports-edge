"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { SportKey, SuggestionsResponse } from "@/lib/types";
import { matchesBoardSearch } from "@/lib/board-search";
import { getActiveSportOptions } from "@/lib/odds-client";
import { BoardIntro } from "./BoardIntro";
import { BoardSearch } from "./BoardSearch";
import { BoardStatus } from "./BoardStatus";
import { SiteNav } from "./SiteNav";
import { SportPicker } from "./SportPicker";
import { SuggestedCard } from "./SuggestedCard";
import { TimingSwitch } from "./TimingSwitch";

type SportFilter = SportKey | "all";

export function SuggestedView() {
  const sportFilters = useMemo<Array<{ key: SportFilter; label: string }>>(
    () => [{ key: "all", label: "All" }, ...getActiveSportOptions()],
    [],
  );
  const [sport, setSport] = useState<SportFilter>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((nextSport: SportFilter) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(
          `/api/suggestions?sport=${nextSport}&timing=upcoming`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setData((await res.json()) as SuggestionsResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load suggestions");
      }
    });
  }, []);

  useEffect(() => {
    load(sport);
  }, [sport, load]);

  const visible = useMemo(() => {
    const list = data?.suggestions ?? [];
    return list.filter((p) =>
      matchesBoardSearch(query, p.homeTeam, p.awayTeam, p.selection),
    );
  }, [data, query]);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Suggested · highest model win%</p>
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

      <BoardIntro board="suggested" />

      <BoardSearch
        value={query}
        onChange={setQuery}
        placeholder="Search teams…"
        matchCount={visible.length}
        totalCount={data?.suggestions.length ?? 0}
      />

      <BoardStatus
        pill="SUGGESTED"
        countLabel={
          data
            ? `${visible.length} moneylines · ranked by win%`
            : "Loading…"
        }
        generatedAt={data?.generatedAt}
      />

      {error && <p className="error-banner">{error}</p>}

      <section className="results" aria-live="polite">
        {pending && !data && <p className="muted">Loading suggestions…</p>}
        {data && data.suggestions.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No suggested moneylines</p>
            <p className="muted">Try another league, or check Edges for priced value.</p>
          </div>
        )}
        {data && data.suggestions.length > 0 && visible.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No matching picks</p>
            <p className="muted">Clear search or try another team name.</p>
          </div>
        )}
        <div className="edge-grid">
          {visible.map((pick) => (
            <SuggestedCard key={pick.id} pick={pick} />
          ))}
        </div>
      </section>
    </div>
  );
}
