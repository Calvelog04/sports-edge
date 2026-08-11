"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { BestPicksResponse, SportKey } from "@/lib/types";
import { SPORT_OPTIONS } from "@/lib/odds-client";
import type { GameTiming } from "@/lib/timing";
import { BestCard } from "./BestCard";
import { OddsQuotaLabel } from "./OddsQuotaLabel";
import { SiteNav } from "./SiteNav";
import { SportPicker } from "./SportPicker";
import { TimingSwitch } from "./TimingSwitch";

type SportFilter = SportKey | "all";

const SPORT_FILTERS: Array<{ key: SportFilter; label: string }> = [
  { key: "all", label: "All" },
  ...SPORT_OPTIONS,
];

export function BestView() {
  const [sport, setSport] = useState<SportFilter>("all");
  const [timing, setTiming] = useState<GameTiming>("upcoming");
  const [data, setData] = useState<BestPicksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((nextSport: SportFilter, nextTiming: GameTiming) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/best?sport=${nextSport}&timing=${nextTiming}`, {
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
    load(sport, timing);
  }, [sport, timing, load]);

  const minWin = data ? (data.thresholds.minWinProb * 100).toFixed(0) : "55";
  const minEdge = data ? data.thresholds.minEdgePct.toFixed(1) : "1.5";

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Best picks — high win% and sportsbook edge</p>
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
          <span className="mode-pill">BEST</span>
          <span className="meta">
            {data ? `${data.picks.length} picks · win ≥${minWin}% · edge ≥${minEdge}%` : "Loading…"}
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
        {pending && !data && <p className="muted">Finding picks that clear both bars…</p>}
        {data && data.picks.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No best picks right now</p>
            <p className="muted">
              Nothing on this slate has both a strong model win probability and a real edge vs the
              books. Try Edges for price value, Suggested for win leans, or another league/timing.
            </p>
          </div>
        )}

        <div className="edge-grid">
          {data?.picks.map((pick) => (
            <BestCard key={pick.id} pick={pick} />
          ))}
        </div>
      </section>
    </div>
  );
}
