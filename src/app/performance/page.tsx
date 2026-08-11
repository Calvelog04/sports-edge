import { PerformanceView } from "@/components/PerformanceView";

export default function PerformancePage() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <PerformanceView />
      <footer className="site-footer">
        <p>
          MintPicks is an educational research tool — not gambling advice. Always check local laws
          and bet responsibly.
        </p>
      </footer>
    </main>
  );
}
