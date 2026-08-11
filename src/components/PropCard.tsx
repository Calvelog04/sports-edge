"use client";

import { useState, useTransition } from "react";
import type { PropOpportunity } from "@/lib/types";
import { formatAmerican, formatEdge, formatKickoff, marketLabel } from "@/lib/format";

export function PropCard({ opportunity }: { opportunity: PropOpportunity }) {
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      setSavedMsg(null);
      try {
        const res = await fetch("/api/picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: opportunity.eventId,
            sport: opportunity.sport,
            sportTitle: opportunity.sportTitle,
            commenceTime: opportunity.commenceTime,
            homeTeam: opportunity.homeTeam,
            awayTeam: opportunity.awayTeam,
            market: opportunity.market,
            selection: opportunity.selection,
            player: opportunity.player,
            line: opportunity.line,
            price: opportunity.bestPrice,
            book: opportunity.bestBook,
            modelProb: opportunity.modelProb,
            edgePct: opportunity.edgePct,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Could not save pick");
        }
        setSavedMsg("Saved to Picks");
      } catch (e) {
        setSavedMsg(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <article className="edge-card prop-card">
      <div className="edge-card-head">
        <div>
          <p className="day-sport">{marketLabel(opportunity.market)}</p>
          <p className="matchup">{opportunity.label}</p>
          <p className="kickoff">
            {opportunity.awayTeam} @ {opportunity.homeTeam} · {formatKickoff(opportunity.commenceTime)}
          </p>
        </div>
        <div className="edge-score">
          <span className="edge-value">{formatEdge(opportunity.edgePct)}</span>
          <span className="edge-label">model edge</span>
        </div>
      </div>

      <div className="top-signal">
        <p className="pick-meta">
          {formatAmerican(opportunity.bestPrice)} at {opportunity.bestBook} · model{" "}
          {(opportunity.modelProb * 100).toFixed(1)}% · EV {formatEdge(opportunity.evPct)}
        </p>
        <button type="button" className="save-pick-btn" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save pick"}
        </button>
        {savedMsg && <p className="save-pick-msg">{savedMsg}</p>}
      </div>

      <ul className="rationale">
        {opportunity.rationale.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </article>
  );
}
