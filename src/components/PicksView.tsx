"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { PickBoardSource, StoredPick } from "@/lib/picks";
import { matchesBoardSearch } from "@/lib/board-search";
import { compareByCommenceAsc } from "@/lib/board-sort";
import { formatAmerican, formatEdge, formatKickoff, marketLabel } from "@/lib/format";
import { GAME_DATE_TZ, gameDateKey } from "@/lib/pick-identity";
import { isPropMarket } from "@/lib/types";
import { BoardSearch } from "./BoardSearch";
import { SiteNav } from "./SiteNav";

type BoardFilter = "all" | PickBoardSource;

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

function resolveBoardSource(pick: StoredPick): PickBoardSource {
  if (pick.boardSource) return pick.boardSource;
  if (isPropMarket(String(pick.market))) return "props";

  // Legacy game picks (saved before boardSource existed) — infer from signal shape.
  const win = pick.modelProb;
  const edge = pick.edgePct;
  if (win >= 0.55 && edge >= 1.5) return "best";
  if (pick.market === "h2h" && win >= 0.5) return "suggested";
  return "edges";
}

function boardLabel(source: PickBoardSource): string {
  switch (source) {
    case "best":
      return "Best";
    case "suggested":
      return "Suggested";
    case "edges":
      return "Edges";
    case "props":
      return "Props";
  }
}

/** Slate calendar day for a kickoff (America/Chicago). */
function commenceDateKey(iso: string): string {
  return gameDateKey(iso, GAME_DATE_TZ);
}

function todayKey(now = new Date()): string {
  return gameDateKey(now.toISOString(), GAME_DATE_TZ);
}

function yesterdayKey(now = new Date()): string {
  const today = todayKey(now);
  const [y, m, d] = today.split("-").map(Number);
  if (!y || !m || !d) return "";
  // Step back one calendar day in the slate TZ
  const noonUtc = Date.UTC(y, m - 1, d, 17, 0, 0) - 86_400_000;
  return gameDateKey(new Date(noonUtc).toISOString(), GAME_DATE_TZ);
}

/** Friendly chip label: Today / Yesterday / Wed, Aug 12 */
function formatDateChipLabel(ymd: string, now = new Date()): string {
  if (ymd === todayKey(now)) return "Today";
  if (ymd === yesterdayKey(now)) return "Yesterday";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  // Noon UTC avoids DST edge cases when labeling a calendar day
  const date = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  const sameYear = y === Number(todayKey(now).slice(0, 4));
  return date.toLocaleDateString("en-US", {
    timeZone: GAME_DATE_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function formatDateFilterLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  return date.toLocaleDateString("en-US", {
    timeZone: GAME_DATE_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PicksView() {
  const [picks, setPicks] = useState<StoredPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "open" | "settled">("all");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  /** Empty = all dates; otherwise YYYY-MM-DD of kickoff. */
  const [dateFilter, setDateFilter] = useState("");
  const [query, setQuery] = useState("");

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

  const dateOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of picks) {
      const key = commenceDateKey(p.commenceTime);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Newest game dates first
    return [...counts.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([ymd, count]) => ({ ymd, count }));
  }, [picks]);

  useEffect(() => {
    if (dateFilter && dateOptions.length > 0 && !dateOptions.some((d) => d.ymd === dateFilter)) {
      setDateFilter("");
    }
  }, [dateFilter, dateOptions]);

  const visible = useMemo(() => {
    return picks
      .filter((p) => {
        if (filter === "open" && p.status !== "open") return false;
        if (filter === "settled" && p.status === "open") return false;
        if (dateFilter && commenceDateKey(p.commenceTime) !== dateFilter) return false;
        if (boardFilter !== "all" && resolveBoardSource(p) !== boardFilter) return false;
        if (!matchesBoardSearch(query, p.homeTeam, p.awayTeam, p.player, p.selection)) {
          return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => {
        const byTime = compareByCommenceAsc(a, b);
        if (byTime !== 0) return byTime;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [picks, filter, dateFilter, boardFilter, query]);

  const record = useMemo(() => {
    const scoped = picks.filter((p) => {
      if (dateFilter && commenceDateKey(p.commenceTime) !== dateFilter) return false;
      if (boardFilter !== "all" && resolveBoardSource(p) !== boardFilter) return false;
      return true;
    });
    const settled = scoped.filter((p) => p.status === "won" || p.status === "lost");
    const won = settled.filter((p) => p.status === "won").length;
    const lost = settled.filter((p) => p.status === "lost").length;
    return { won, lost, open: scoped.filter((p) => p.status === "open").length };
  }, [picks, dateFilter, boardFilter]);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Your saved picks &amp; results</p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <div className="timing-switch" role="tablist" aria-label="Pick status">
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

      <BoardSearch
        value={query}
        onChange={setQuery}
        placeholder="Search teams or players…"
        matchCount={visible.length}
        totalCount={picks.length}
      />

      <div className="picks-date-row" role="tablist" aria-label="Filter by board source">
        <span className="picks-date-label">Source</span>
        <div className="picks-date-chips">
          {(
            [
              ["all", "All"],
              ["best", "Best"],
              ["suggested", "Suggested"],
              ["edges", "Edges"],
              ["props", "Props"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={boardFilter === key ? "timing-chip active" : "timing-chip"}
              onClick={() => setBoardFilter(key)}
              aria-pressed={boardFilter === key}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {dateOptions.length > 0 && (
        <div className="picks-date-row" role="tablist" aria-label="Filter by game date">
          <span className="picks-date-label">Game day (CT)</span>
          <div className="picks-date-chips">
            <button
              type="button"
              className={!dateFilter ? "timing-chip active" : "timing-chip"}
              onClick={() => setDateFilter("")}
              aria-pressed={!dateFilter}
            >
              All days
            </button>
            {dateOptions.map(({ ymd }) => (
              <button
                key={ymd}
                type="button"
                className={dateFilter === ymd ? "timing-chip active" : "timing-chip"}
                onClick={() => setDateFilter(ymd)}
                aria-pressed={dateFilter === ymd}
                title={formatDateFilterLabel(ymd)}
              >
                {formatDateChipLabel(ymd)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`status-banner live`}>
        <div>
          <span className="mode-pill">RECORD</span>
          <span className="meta">
            {record.won}-{record.lost}
            {record.open > 0 ? ` · ${record.open} open` : ""}
            {boardFilter !== "all" ? ` · ${boardLabel(boardFilter)}` : ""}
          </span>
        </div>
      </div>

      {message && <p className="info-banner">{message}</p>}
      {error && <p className="error-banner">{error}</p>}

      <section className="results" aria-live="polite">
        {visible.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">
              {picks.length === 0
                ? "No picks yet"
                : query.trim()
                  ? "No matching picks"
                  : "No picks for this filter"}
            </p>
            <p className="muted">
              {picks.length === 0 ? (
                <>
                  Save from <strong>Best</strong>, <strong>Suggested</strong>, <strong>Edges</strong>,
                  or <strong>Props</strong>. After games finish, use <strong>Check results</strong>{" "}
                  here to grade them.
                </>
              ) : (
                <>
                  Try another board, date, or status
                  {dateFilter ? (
                    <>
                      {" "}
                      · viewing {formatDateFilterLabel(dateFilter)}
                    </>
                  ) : null}
                  .
                </>
              )}
            </p>
          </div>
        )}

        <div className="edge-grid">
          {visible.map((pick) => {
            const source = resolveBoardSource(pick);
            return (
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
                    <span className={`edge-label board-source-under source-${source}`}>
                      from {boardLabel(source)}
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
            );
          })}
        </div>
      </section>
    </div>
  );
}
