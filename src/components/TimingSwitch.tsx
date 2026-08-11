"use client";

import type { GameTiming } from "@/lib/timing";

export function TimingSwitch({
  value,
  onChange,
}: {
  value: GameTiming;
  onChange: (timing: GameTiming) => void;
}) {
  return (
    <div className="timing-switch" role="tablist" aria-label="Game timing">
      <button
        type="button"
        role="tab"
        aria-selected={value === "live"}
        className={value === "live" ? "timing-chip active" : "timing-chip"}
        onClick={() => onChange("live")}
      >
        Live
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "upcoming"}
        className={value === "upcoming" ? "timing-chip active" : "timing-chip"}
        onClick={() => onChange("upcoming")}
      >
        Upcoming
      </button>
    </div>
  );
}
