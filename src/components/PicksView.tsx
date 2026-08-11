"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { StoredPick } from "@/lib/picks";
import { formatAmerican, formatEdge, formatKickoff, marketLabel } from "@/lib/format";
import { SiteNav } from "./SiteNav";

function statusLabel(status: StoredPick["status"]): string {
  switch (status) {
    case "won":
      return "CORRECT";
    case "lost":
      return "WRONG";
    case "push":
      return "PUSH";
    case "void":
      return "VOID";
    default:
      return "OPEN";
  }
}

export function PicksView() {
  const [picks, setPicks] = useState<StoredPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "open" | "settled">("all");

  const load = useCallback(() => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/picks", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load picks");
        const json = (await res.json()) as { picks: StoredPick[] };
        setPicks(json.picks ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load picks");
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const settle = useCallback(() => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const res = await fetch("/api/picks/settle", { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Settle failed");
        }
        const json = (await res.json()) as {
          picks: StoredPick[];
          settled: number;
          stillOpen: number;
        };
        setPicks(json.picks);
        setMessage(
          json.settled > 0
            ? `Settled ${json.settled} pick${json.settled === 1 ? "" : "s"}. ${json.stillOpen} still open.`
            : `No new completed games found. ${json.stillOpen} pick${json.stillOpen === 1 ? "" : "s"} still open.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Settle failed");
      }
    });
  }, []);

  const remove = useCallback((id: string) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/picks/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Could not delete pick");
        setPicks((prev) => prev.filter((p) => p.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    });
  }, []);

  const visible = useMemo(() => {
    if (filter === "open") return picks.filter((p) => p.status === "open");
    if (filter === "settled") return picks.filter((p) => p.status !== "open");
    return picks;
  }, [picks, filter]);

  const record = useMemo(() => {
    const settled = picks.filter((p) => p.status === "won" || p.status === "lost");
    const won = settled.filter((p) => p.status === "won").length;
    const lost = settled.filter((p) => p.status === "lost").length;
    return { won, lost, open: picks.filter((p) => p.status === "open").length };
  }, [picks]);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Your saved picks &amp; results</p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <div className="timing-switch" role="tablist" aria-label="Pick filter">
            <button
              type="button"
              className={filter === "all" ? "timing-chip active" : "timing-chip"}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={filter === "open" ? "timing-chip active" : "timing-chip"}
              onClick={() => setFilter("open")}
            >
              Open
            </button>
            <button
              type="button"
              className={filter === "settled" ? "timing-chip active" : "timing-chip"}
              onClick={() => setFilter("settled")}
            >
              Settled
            </button>
          </div>
          <button type="button" className="refresh-btn" onClick={settle} disabled={pending}>
            {pending ? "Working…" : "Check results"}
          </button>
        </div>
      </header>

      <div className={`status-banner live`}>
        <div>
          <span className="mode-pill">RECORD</span>
          <span className="meta">
            {record.won}-{record.lost}
            {record.open > 0 ? ` · ${record.open} open` : ""}
          </span>
        </div>
      </div>

      {message && <p className="info-banner">{message}</p>}
      {error && <p className="error-banner">{error}</p>}

      <section className="results" aria-live="polite">
        {visible.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">No picks yet</p>
            <p className="muted">
              On the Edges board, hit <strong>Save pick</strong> on a game. After it finishes, use{" "}
              <strong>Check results</strong> here to grade it.
            </p>
          </div>
        )}

        <div className="edge-grid">
          {visible.map((pick) => (
            <article key={pick.id} className={`edge-card pick-card status-${pick.status}`}>
              <div className="edge-card-head">
                <div>
                  <p className="day-sport">{pick.sportTitle}</p>
                  <p className="matchup">
                    {pick.awayTeam} <span className="at">@</span> {pick.homeTeam}
                  </p>
                  <p className="kickoff">{formatKickoff(pick.commenceTime)}</p>
                </div>
                <div className="edge-score">
                  <span className={`edge-value result-${pick.status}`}>
                    {statusLabel(pick.status)}
                  </span>
                  <span className="edge-label">
                    {pick.status === "open" ? "awaiting final" : "prediction"}
                  </span>
                </div>
              </div>

              <div className="top-signal">
                <p className="pick">
                  {marketLabel(pick.market)} ·{" "}
                  {pick.player ? `${pick.player} · ` : ""}
                  {pick.selection}
                  {pick.line != null ? ` ${pick.line > 0 ? "+" : ""}${pick.line}` : ""}
                </p>
                <p className="pick-meta">
                  {formatAmerican(pick.price)} at {pick.book} · model edge{" "}
                  {formatEdge(pick.edgePct)} · {(pick.modelProb * 100).toFixed(1)}% model
                </p>
              </div>

              {pick.result && (
                <p className={`result-note ${pick.status}`}>{pick.result.note}</p>
              )}

              <div className="pick-actions">
                <button type="button" className="details-toggle" onClick={() => remove(pick.id)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
