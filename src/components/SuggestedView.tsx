"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { SportKey, SuggestionsResponse } from "@/lib/types";
import { SPORT_OPTIONS } from "@/lib/odds-client";
import type { GameTiming } from "@/lib/timing";
import { OddsQuotaLabel } from "./OddsQuotaLabel";
import { SiteNav } from "./SiteNav";
import { SportPicker } from "./SportPicker";
import { SuggestedCard } from "./SuggestedCard";
import { TimingSwitch } from "./TimingSwitch";

type SportFilter = SportKey | "all";

const SPORT_FILTERS: Array<{ key: SportFilter; label: string }> = [
  { key: "all", label: "All" },
  ...SPORT_OPTIONS,
];

export function SuggestedView() {
  const [sport, setSport] = useState<SportFilter>("all");
  const [timing, setTiming] = useState<GameTiming>("upcoming");
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((nextSport: SportFilter, nextTiming: GameTiming) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(
          `/api/suggestions?sport=${nextSport}&timing=${nextTiming}`,
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
    load(sport, timing);
  }, [sport, timing, load]);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Suggested picks — highest model win probability</p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <TimingSwitch value={timing} onChange={setTiming} />
          <SportPicker sports={SPORT_FILTERS} value={sport} onChange={setSport} />
          <button
            type="button"
            className="refresh-btn"
            onClick={() => load(sport, timing)}
            disabled={pending}
          >
            {pending ? "Scanning…" : "Rescan"}
          </button>
        </div>
      </header>

      <div className={`status-banner ${data?.mode === "live" ? "live" : ""}`}>
        <div>
          <span className="mode-pill">SUGGESTED</span>
          <span className="meta">
            {data
              ? `${data.suggestions.length} moneylines · ranked by model win%`
              : "Loading…"}
            {data ? (
              <>
                {" · "}
                <OddsQuotaLabel quota={data.oddsQuota} />
              </>
            ) : null}
          </span>
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <section className="results" aria-live="polite">
        {pending && !data && <p className="muted">Finding the model’s strongest win leans…</p>}
        {data && data.suggestions.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No suggested winners yet</p>
            <p className="muted">
              Suggestions need a moneyline lean of at least 52% model win probability. Try another
              league or Upcoming vs Live.
            </p>
          </div>
        )}

        <div className="edge-grid">
          {data?.suggestions.map((pick) => (
            <SuggestedCard key={pick.id} pick={pick} />
          ))}
        </div>
      </section>
    </div>
  );
}
