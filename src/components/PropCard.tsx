"use client";

import { useState, useTransition } from "react";
import type { PropOpportunity } from "@/lib/types";
import { formatAmerican, formatEdge, formatKickoff, marketLabel } from "@/lib/format";
import { useSavedPicks } from "@/hooks/useSavedPicks";

export function PropCard({ opportunity }: { opportunity: PropOpportunity }) {
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isSaved, markSaved } = useSavedPicks();
  const identity = {
    eventId: opportunity.eventId,
    market: opportunity.market,
    selection: opportunity.selection,
    player: opportunity.player,
    line: opportunity.line,
    homeTeam: opportunity.homeTeam,
    awayTeam: opportunity.awayTeam,
    commenceTime: opportunity.commenceTime,
  };
  const alreadySaved = isSaved(identity);

  function save() {
    if (alreadySaved) {
      setSavedMsg("Already saved in Picks");
      return;
    }
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
            boardSource: "props",
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Could not save pick");
        }
        markSaved(identity);
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
        <div className="best-metrics">
          <div className="edge-score">
            <span className="edge-value win-prob">
              {(opportunity.modelProb * 100).toFixed(1)}%
            </span>
            <span className="edge-label">suggested</span>
          </div>
          <div className="edge-score">
            <span className="edge-value">{formatEdge(opportunity.edgePct)}</span>
            <span className="edge-label">model edge</span>
          </div>
        </div>
      </div>

      <div className="top-signal">
        <p className="pick-meta">
          {formatAmerican(opportunity.bestPrice)} at {opportunity.bestBook} · book implies{" "}
          {(opportunity.bookImpliedProb * 100).toFixed(1)}% · EV{" "}
          {formatEdge(opportunity.evPct)}
        </p>
        <button
          type="button"
          className={`save-pick-btn${alreadySaved ? " is-saved" : ""}`}
          disabled={pending || alreadySaved}
          onClick={save}
        >
          {pending ? "Saving…" : alreadySaved ? "Saved pick" : "Save pick"}
        </button>
        {(savedMsg || alreadySaved) && (
          <p className="save-pick-msg">{savedMsg ?? "Already saved in Picks"}</p>
        )}
      </div>

      <ul className="rationale">
        {opportunity.rationale.slice(0, 2).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </article>
  );
}
