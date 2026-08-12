"use client";

import { useState, useTransition } from "react";
import type { SuggestedPick } from "@/lib/types";
import { formatAmerican, formatEdge, formatKickoff } from "@/lib/format";
import { useSavedPicks } from "@/hooks/useSavedPicks";

export function SuggestedCard({ pick }: { pick: SuggestedPick }) {
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isSaved, markSaved } = useSavedPicks();
  const identity = {
    eventId: pick.eventId,
    market: pick.market,
    selection: pick.selection,
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
            price: pick.bestPrice,
            book: pick.bestBook,
            modelProb: pick.modelProb,
            edgePct: pick.edgePct,
            boardSource: "suggested",
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
    <article className="edge-card suggested-card">
      <div className="edge-card-head">
        <div>
          <p className="day-sport">
            #{pick.rank} · {pick.sportTitle} · Moneyline
          </p>
          <p className="matchup">{pick.selection}</p>
          <p className="kickoff">
            {pick.awayTeam} @ {pick.homeTeam} · {formatKickoff(pick.commenceTime)}
          </p>
        </div>
        <div className="edge-score">
          <span className="edge-value win-prob">{(pick.modelProb * 100).toFixed(1)}%</span>
          <span className="edge-label">model win%</span>
        </div>
      </div>

      <div className="top-signal">
        <p className="pick-meta">
          {formatAmerican(pick.bestPrice)} at {pick.bestBook} · edge{" "}
          {formatEdge(pick.edgePct)} · book implies {(pick.bookImpliedProb * 100).toFixed(1)}%
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
