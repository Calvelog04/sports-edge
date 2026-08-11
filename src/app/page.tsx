import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <Dashboard />
      <footer className="site-footer">
        <p>
          Educational tool — not betting advice. FanDuel has no public API; live lines come from{" "}
          <a href="https://the-odds-api.com" target="_blank" rel="noreferrer">
            The Odds API
          </a>
          . Scores/injuries via ESPN public feeds. Weather via Open-Meteo.
        </p>
      </footer>
    </main>
  );
}
