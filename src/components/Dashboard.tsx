"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { EdgesResponse, SportKey } from "@/lib/types";
import { DEFAULT_SPORT, SPORT_OPTIONS } from "@/lib/odds-client";
import type { GameTiming } from "@/lib/timing";
import { EdgeCard } from "./EdgeCard";
import { SiteNav } from "./SiteNav";
import { SportPicker } from "./SportPicker";
import { StatusBanner } from "./StatusBanner";
import { TimingSwitch } from "./TimingSwitch";

export function Dashboard() {
  const [sport, setSport] = useState<SportKey>(DEFAULT_SPORT);
  const [timing, setTiming] = useState<GameTiming>("upcoming");
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

  const league = SPORT_OPTIONS.find((s) => s.key === sport)?.label ?? sport;

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Live odds only — MLB · NFL · NCAAF · NBA · NCAAB · NHL</p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <TimingSwitch value={timing} onChange={setTiming} />
          <SportPicker sports={SPORT_OPTIONS} value={sport} onChange={setSport} />
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

      {data && <StatusBanner data={data} />}
      {error && <p className="error-banner">{error}</p>}

      <section className="results" aria-live="polite">
        {pending && !data && <p className="muted">Loading slate…</p>}
        {data && data.mode === "unavailable" && data.opportunities.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No live odds yet</p>
            <p className="muted">
              Demo games are turned off. Add a free{" "}
              <a href="https://the-odds-api.com" target="_blank" rel="noreferrer">
                The Odds API
              </a>{" "}
              key to <code>.env.local</code> as <code>ODDS_API_KEY=...</code>, then restart{" "}
              <code>npm run dev</code>.
            </p>
          </div>
        )}
        {data && data.mode === "live" && data.opportunities.length === 0 && (
          <p className="muted">
            No {timing === "live" ? "in-play" : "upcoming"} {league} games with book odds right
            now. Try the other timing switch or another league.
          </p>
        )}
        <div className="edge-grid">
          {data?.opportunities.map((opp) => (
            <EdgeCard key={opp.eventId} opportunity={opp} />
          ))}
        </div>
      </section>
    </div>
  );
}
