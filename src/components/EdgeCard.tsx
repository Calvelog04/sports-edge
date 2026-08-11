"use client";

import { useState, useTransition } from "react";
import type { EdgeOpportunity, ModelSignal } from "@/lib/types";
import { formatAmerican, formatEdge, formatKickoff, marketLabel } from "@/lib/format";

export function EdgeCard({ opportunity }: { opportunity: EdgeOpportunity }) {
  const [open, setOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const top = opportunity.signals[0];

  function saveSignal(signal: ModelSignal) {
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
            market: signal.market,
            selection: signal.selection,
            line: signal.line,
            price: signal.bestPrice,
            book: signal.bestBook,
            modelProb: signal.modelProb,
            edgePct: signal.edgePct,
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
    <article className="edge-card">
      <div className="edge-card-head">
        <div>
          <p className="matchup">
            {opportunity.awayTeam} <span className="at">@</span> {opportunity.homeTeam}
          </p>
          <p className="kickoff">{formatKickoff(opportunity.commenceTime)}</p>
        </div>
        <div className="edge-score" title="Model edge vs best book price">
          <span className="edge-value">{formatEdge(opportunity.bestEdge)}</span>
          <span className="edge-label">model edge</span>
        </div>
      </div>

      {top && (
        <div className="top-signal">
          <p className="pick">
            {marketLabel(top.market)} · {top.selection}
            {top.line != null ? ` ${top.line > 0 ? "+" : ""}${top.line}` : ""}
          </p>
          <p className="pick-meta">
            {formatAmerican(top.bestPrice)} at {top.bestBook} · EV {formatEdge(top.evPct)} ·{" "}
            {(top.confidence * 100).toFixed(0)}% confidence
            {opportunity.kellyPct != null && opportunity.kellyPct > 0
              ? ` · Kelly ${(opportunity.kellyPct * 100).toFixed(2)}% BR`
              : ""}
          </p>
          <button
            type="button"
            className="save-pick-btn"
            disabled={pending}
            onClick={() => saveSignal(top)}
          >
            {pending ? "Saving…" : "Save pick"}
          </button>
          {savedMsg && <p className="save-pick-msg">{savedMsg}</p>}
        </div>
      )}

      {opportunity.weather?.outdoorRelevant && (
        <p className="weather-line">
          {opportunity.weather.condition} · {opportunity.weather.tempF}°F · wind{" "}
          {opportunity.weather.windMph} mph
          {opportunity.weather.humidity != null ? ` · humidity ${opportunity.weather.humidity}%` : ""}
          {" · "}
          {opportunity.weather.location}
          {opportunity.weather.source === "weather-underground"
            ? " · Data provided by Weather Underground"
            : opportunity.weather.source
              ? ` · via ${opportunity.weather.source}`
              : ""}
        </p>
      )}

      {(opportunity.history?.home || opportunity.history?.away) && (
        <p className="history-line">
          ESPN history:{" "}
          {[
            opportunity.history?.away
              ? `${opportunity.history.away.abbreviation || opportunity.awayTeam} ${
                  opportunity.history.away.seasonRecord ??
                  (opportunity.history.away.historicalWinPct != null
                    ? `${(opportunity.history.away.historicalWinPct * 100).toFixed(0)}% hist`
                    : "")
                }`
              : null,
            opportunity.history?.home
              ? `${opportunity.history.home.abbreviation || opportunity.homeTeam} ${
                  opportunity.history.home.seasonRecord ??
                  (opportunity.history.home.historicalWinPct != null
                    ? `${(opportunity.history.home.historicalWinPct * 100).toFixed(0)}% hist`
                    : "")
                }`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {opportunity.pitchers && (opportunity.pitchers.home || opportunity.pitchers.away) && (
        <p className="history-line">
          Probables:{" "}
          {[
            opportunity.pitchers.away
              ? `${opportunity.pitchers.away.fullName}${
                  opportunity.pitchers.away.era != null
                    ? ` ${opportunity.pitchers.away.era.toFixed(2)}`
                    : ""
                }`
              : opportunity.awayTeam,
            opportunity.pitchers.home
              ? `${opportunity.pitchers.home.fullName}${
                  opportunity.pitchers.home.era != null
                    ? ` ${opportunity.pitchers.home.era.toFixed(2)}`
                    : ""
                }`
              : opportunity.homeTeam,
          ].join(" @ ")}
        </p>
      )}

      {opportunity.restTravel?.note ? (
        <p className="history-line">{opportunity.restTravel.note}</p>
      ) : null}

      {opportunity.savant && (
        <p className="history-line">
          Savant Statcast: home lean {(opportunity.savant.homeWinLean * 100).toFixed(0)}%
          {opportunity.savant.home.hitting?.xwoba != null &&
          opportunity.savant.away.hitting?.xwoba != null
            ? ` · xwOBA ${opportunity.savant.away.hitting.teamAbbrev} ${opportunity.savant.away.hitting.xwoba.toFixed(3)} @ ${opportunity.savant.home.hitting.teamAbbrev} ${opportunity.savant.home.hitting.xwoba.toFixed(3)}`
            : ""}
          {opportunity.savant.home.hitting?.barrelPct != null &&
          opportunity.savant.away.hitting?.barrelPct != null
            ? ` · barrel% ${opportunity.savant.away.hitting.barrelPct.toFixed(1)}/${opportunity.savant.home.hitting.barrelPct.toFixed(1)}`
            : ""}
        </p>
      )}

      {opportunity.espn?.injuries?.length ? (
        <p className="injury-line">
          ESPN injuries:{" "}
          {opportunity.espn.injuries
            .slice(0, 3)
            .map((i) => `${i.athlete} (${i.status})`)
            .join(" · ")}
        </p>
      ) : null}

      <button type="button" className="details-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide breakdown" : "Show model breakdown"}
      </button>

      {open && (
        <div className="details">
          {(opportunity.history?.home || opportunity.history?.away) && (
            <div className="history-panel">
              <p className="books-title">ESPN team &amp; player history</p>
              {[opportunity.history?.away, opportunity.history?.home]
                .filter(Boolean)
                .map((team) =>
                  team ? (
                    <div key={team.teamId} className="history-team">
                      <strong>
                        {team.displayName}
                        {team.seasonRecord ? ` (${team.seasonRecord})` : ""}
                      </strong>
                      {team.standingSummary && (
                        <p className="signal-meta">{team.standingSummary}</p>
                      )}
                      {team.recentSeasons.length > 0 && (
                        <p className="signal-meta">
                          Recent:{" "}
                          {team.recentSeasons
                            .slice(0, 3)
                            .map(
                              (s) =>
                                `${s.season} ${s.wins}-${s.losses} (${(s.winPct * 100).toFixed(0)}%)`,
                            )
                            .join(" · ")}
                        </p>
                      )}
                      {team.leaders.map((p) => (
                        <p key={p.athleteId} className="signal-meta">
                          {p.name}
                          {p.position ? ` (${p.position})` : ""} — {p.highlights.join(", ")}
                        </p>
                      ))}
                    </div>
                  ) : null,
                )}
            </div>
          )}

          {opportunity.savant && (
            <div className="history-panel">
              <p className="books-title">
                Baseball Savant Statcast ({opportunity.savant.season})
              </p>
              <p className="signal-meta">
                Home win lean {(opportunity.savant.homeWinLean * 100).toFixed(1)}% · totals lean{" "}
                {opportunity.savant.totalOverLean > 0 ? "Over" : opportunity.savant.totalOverLean < 0 ? "Under" : "neutral"}{" "}
                ({opportunity.savant.totalOverLean >= 0 ? "+" : ""}
                {(opportunity.savant.totalOverLean * 100).toFixed(1)} pts)
              </p>
              {[
                { label: opportunity.awayTeam, side: opportunity.savant.away },
                { label: opportunity.homeTeam, side: opportunity.savant.home },
              ].map(({ label, side }) => (
                <div key={label} className="history-team">
                  <strong>
                    {side.hitting?.teamAbbrev || label}
                    {side.hitting?.league ? ` · ${side.hitting.league}` : ""}
                  </strong>
                  <p className="signal-meta">
                    Hitting: xwOBA {side.hitting?.xwoba?.toFixed(3) ?? "—"} · wOBA{" "}
                    {side.hitting?.woba?.toFixed(3) ?? "—"} · barrel{" "}
                    {side.hitting?.barrelPct != null ? `${side.hitting.barrelPct.toFixed(1)}%` : "—"} ·
                    hard-hit{" "}
                    {side.hitting?.hardHitPct != null
                      ? `${side.hitting.hardHitPct.toFixed(1)}%`
                      : "—"}{" "}
                    · EV {side.hitting?.exitVelo?.toFixed(1) ?? "—"}
                  </p>
                  <p className="signal-meta">
                    Pitching: xwOBA allowed {side.pitching?.xwoba?.toFixed(3) ?? "—"} · barrel vs{" "}
                    {side.pitching?.barrelPct != null
                      ? `${side.pitching.barrelPct.toFixed(1)}%`
                      : "—"}{" "}
                    · K% {side.pitching?.kPct != null ? `${side.pitching.kPct.toFixed(1)}%` : "—"} ·
                    whiff{" "}
                    {side.pitching?.whiffPct != null ? `${side.pitching.whiffPct.toFixed(1)}%` : "—"}
                  </p>
                </div>
              ))}
              <p className="signal-meta">
                <a href={opportunity.savant.sourceUrl} target="_blank" rel="noreferrer">
                  baseballsavant.mlb.com/league
                </a>
              </p>
            </div>
          )}
          <ul className="signal-list">
            {opportunity.signals.map((s) => (
              <li key={`${s.market}-${s.selection}-${s.line ?? ""}`}>
                <div className="signal-row">
                  <strong>
                    {marketLabel(s.market)} {s.selection}
                    {s.line != null ? ` ${s.line}` : ""}
                  </strong>
                  <span>{formatEdge(s.edgePct)} edge</span>
                </div>
                <p className="signal-meta">
                  Model {(s.modelProb * 100).toFixed(1)}% vs book{" "}
                  {(s.bookImpliedProb * 100).toFixed(1)}% · {formatAmerican(s.bestPrice)}{" "}
                  {s.bestBook}
                </p>
                <button
                  type="button"
                  className="save-pick-btn compact"
                  disabled={pending}
                  onClick={() => saveSignal(s)}
                >
                  Save this pick
                </button>
                <ul className="rationale">
                  {s.rationale.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <div className="books">
            <p className="books-title">Book board (FanDuel + others)</p>
            <table>
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Market</th>
                  <th>Pick</th>
                  <th>Odds</th>
                </tr>
              </thead>
              <tbody>
                {opportunity.bookOdds.slice(0, 18).map((row, i) => (
                  <tr key={`${row.book}-${row.market}-${row.selection}-${i}`}>
                    <td>{row.book}</td>
                    <td>{marketLabel(row.market)}</td>
                    <td>
                      {row.selection}
                      {row.point != null ? ` ${row.point}` : ""}
                    </td>
                    <td>{formatAmerican(row.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </article>
  );
}
