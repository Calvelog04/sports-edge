import { BestView } from "@/components/BestView";

export default function BestPage() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <BestView />
      <footer className="site-footer">
        <p>
          Best picks combine Suggested (high model win%) with Edges (positive sportsbook edge). Both
          bars must clear — educational research, not betting advice.
        </p>
      </footer>
    </main>
  );
}
