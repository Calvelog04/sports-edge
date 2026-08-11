import { InfoView } from "@/components/InfoView";

export default function InfoPage() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <InfoView />
      <footer className="site-footer">
        <p>
          MintPicks is an educational research tool — not gambling advice. Always check local laws
          and bet responsibly.
        </p>
      </footer>
    </main>
  );
}
