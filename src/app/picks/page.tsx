import { PicksView } from "@/components/PicksView";

export default function PicksPage() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <PicksView />
      <footer className="site-footer">
        <p>
          Picks are stored on this machine in <code>data/picks.json</code>. Game lines grade from
          The Odds API scores; MLB props grade from official box scores (hits, HRs, 1st-inning
          runs).
        </p>
      </footer>
    </main>
  );
}
