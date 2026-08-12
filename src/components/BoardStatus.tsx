"use client";

import {
  formatLinesFrom,
  formatShortWhen,
  nextOddsRefreshAt,
  nextPropsRefreshAt,
} from "@/lib/odds-window";

type Kind = "game" | "live" | "props";

export function BoardStatus({
  generatedAt,
  countLabel,
  freshness,
  kind = "game",
  pill,
}: {
  generatedAt?: string | null;
  countLabel: string;
  freshness?: "fresh" | "cached" | null;
  kind?: Kind;
  pill: string;
}) {
  const linesFrom = generatedAt ? formatLinesFrom(generatedAt) : null;
  const next =
    kind === "props"
      ? formatShortWhen(nextPropsRefreshAt())
      : kind === "live"
        ? "about every 2 min (ESPN)"
        : formatShortWhen(nextOddsRefreshAt());

  const freshLabel =
    freshness === "cached" ? "Cached" : freshness === "fresh" ? "Fresh" : null;

  return (
    <div className={`status-banner ${kind === "live" ? "live" : ""}`}>
      <div>
        <span className="mode-pill">{pill}</span>
        <span className="meta">
          {countLabel}
          {linesFrom ? ` · Lines from ${linesFrom}` : null}
          {` · Next update ${next}`}
          {freshLabel ? (
            <>
              {" · "}
              <span className={`freshness-pill ${freshness}`}>{freshLabel}</span>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
