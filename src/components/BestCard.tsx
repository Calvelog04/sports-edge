"use client";

import { useState, useTransition } from "react";
import type { BestPick } from "@/lib/types";
import { formatAmerican, formatEdge, formatKickoff, marketLabel } from "@/lib/format";
import { useSavedPicks } from "@/hooks/useSavedPicks";

export function BestCard({ pick }: { pick: BestPick }) {
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isSaved, markSaved } = useSavedPicks();
  const identity = {
    eventId: pick.eventId,
    market: pick.market,
    selection: pick.selection,
    line: pick.line,
    homeTeam: pick.homeTeam,
    awayTeam: pick.awayTeam,
    commenceTime: pick.commenceTime,
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
            eventId: pick.eventId,
            sport: pick.sport,
            sportTitle: pick.sportTitle,
            commenceTime: pick.commenceTime,
            homeTeam: pick.homeTeam,
            awayTeam: pick.awayTeam,
            market: pick.market,
            selection: pick.selection,
            line: pick.line,
            price: pick.bestPrice,
            book: pick.bestBook,
            modelProb: pick.modelProb,
            edgePct: pick.edgePct,
            boardSource: "best",
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
    <article className="edge-card best-card">
      <div className="edge-card-head">
        <div>
          <p className="day-sport">
            #{pick.rank} · {pick.sportTitle} · {marketLabel(pick.market)}
          </p>
          <p className="matchup">
            {pick.selection}
            {pick.line != null ? ` ${pick.line > 0 ? "+" : ""}${pick.line}` : ""}
          </p>
          <p className="kickoff">
            {pick.awayTeam} @ {pick.homeTeam} · {formatKickoff(pick.commenceTime)}
          </p>
        </div>
        <div className="best-metrics">
          <div className="edge-score">
            <span className="edge-value win-prob">{(pick.modelProb * 100).toFixed(1)}%</span>
            <span className="edge-label">model win%</span>
          </div>
          <div className="edge-score">
            <span className="edge-value">{formatEdge(pick.edgePct)}</span>
            <span className="edge-label">book edge</span>
          </div>
        </div>
      </div>

      <div className="top-signal">
        <p className="pick-meta">
          {formatAmerican(pick.bestPrice)} at {pick.bestBook} · book implies{" "}
          {(pick.bookImpliedProb * 100).toFixed(1)}% · EV {formatEdge(pick.evPct)}
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
        {pick.rationale.slice(0, 2).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </article>
  );
}
