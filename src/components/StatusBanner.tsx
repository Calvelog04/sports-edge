import type { EdgesResponse } from "@/lib/types";

export function StatusBanner({ data }: { data: EdgesResponse }) {
  const pill = data.mode === "live" ? "LIVE ODDS" : "NO LIVE ODDS";
  const timingLabel = data.timing === "live" ? "in-play" : "upcoming";

  return (
    <div className={`status-banner ${data.mode}`}>
      <div>
        <span className="mode-pill">{pill}</span>
        <span className="meta">
          {data.opportunities.length} {timingLabel} games with edge · scanned{" "}
          {new Date(data.generatedAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
