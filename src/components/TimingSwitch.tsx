"use client";

import { LIVE_BETS_ENABLED } from "@/lib/timing";

export function TimingSwitch(props: {
  value?: "live" | "upcoming";
  onChange?: (timing: "live" | "upcoming") => void;
  /** When false, hide Live and show Upcoming only. Defaults to LIVE_BETS_ENABLED. */
  enabled?: boolean;
  liveTitle?: string;
}) {
  const enabled = props.enabled ?? LIVE_BETS_ENABLED;

  if (!enabled) {
    return (
      <div className="timing-switch" aria-label="Game timing">
        <span className="timing-chip active">Upcoming only</span>
      </div>
    );
  }

  const value = props.value ?? "upcoming";

  return (
    <div className="timing-switch" role="tablist" aria-label="Game timing">
      <button
        type="button"
        className={value === "upcoming" ? "timing-chip active" : "timing-chip"}
        onClick={() => props.onChange?.("upcoming")}
        aria-pressed={value === "upcoming"}
      >
        Upcoming
      </button>
      <button
        type="button"
        className={value === "live" ? "timing-chip active" : "timing-chip"}
        onClick={() => props.onChange?.("live")}
        aria-pressed={value === "live"}
        title={
          props.liveTitle ??
          "In-play game results (ML / spread / total) via ESPN"
        }
      >
        Live
      </button>
    </div>
  );
}
