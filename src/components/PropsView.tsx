"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { PropOpportunity, PropsResponse } from "@/lib/types";
import type { GameTiming } from "@/lib/timing";
import { OddsQuotaLabel } from "./OddsQuotaLabel";
import { PropCard } from "./PropCard";
import { SiteNav } from "./SiteNav";
import { TimingSwitch } from "./TimingSwitch";

type PropFilter = "all" | "hit" | "home_run" | "first_inning";

export function PropsView() {
  const [timing, setTiming] = useState<GameTiming>("upcoming");
  const [filter, setFilter] = useState<PropFilter>("all");
  const [data, setData] = useState<PropsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((nextTiming: GameTiming) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/props?timing=${nextTiming}`, { cache: "no-store" });
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
    const list = data?.opportunities ?? [];
    if (filter === "all") return list;
    return list.filter((o) => o.category === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const list = data?.opportunities ?? [];
    return {
      all: list.length,
      hit: list.filter((o) => o.category === "hit").length,
      home_run: list.filter((o) => o.category === "home_run").length,
      first_inning: list.filter((o) => o.category === "first_inning").length,
    };
  }, [data]);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">MLB prop bets — hits, home runs, 1st inning</p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <TimingSwitch value={timing} onChange={setTiming} />
          <button
            type="button"
            className="refresh-btn"
            onClick={() => load(timing)}
            disabled={pending}
          >
            {pending ? "Scanning…" : "Rescan props"}
          </button>
        </div>
      </header>

      <div className={`status-banner ${data?.mode === "live" ? "live" : ""}`}>
        <div>
          <span className="mode-pill">{data?.mode === "live" ? "PROPS" : "WAITING"}</span>
          <span className="meta">
            {data
              ? `${data.eventsScanned} games scanned · ${data.opportunities.length} edges`
              : "Loading MLB prop markets…"}
            {data ? (
              <>
                {" · "}
                <OddsQuotaLabel quota={data.oddsQuota} />
              </>
            ) : null}
          </span>
        </div>
      </div>

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
        {pending && !data && <p className="muted">Pulling FanDuel/DK player props…</p>}
        {data && visible.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No prop edges yet</p>
            <p className="muted">
              Looking for +EV on player to record a hit, player to hit a home run, and first-inning
              over/unders. Props often appear closer to first pitch — try Rescan later.
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
