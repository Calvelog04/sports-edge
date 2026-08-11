import { PropsView } from "@/components/PropsView";

export default function PropsPage() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <PropsView />
      <footer className="site-footer">
        <p>
          MLB props use The Odds API event markets: batter hits, batter home runs, and 1st-inning
          totals (FanDuel, DraftKings, and others). Save props to Picks like game edges.
        </p>
      </footer>
    </main>
  );
}
