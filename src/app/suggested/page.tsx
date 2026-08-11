import { SuggestedView } from "@/components/SuggestedView";

export default function SuggestedPage() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <SuggestedView />
      <footer className="site-footer">
        <p>
          Suggested picks rank moneylines by model win probability — the side the model thinks is
          most likely to win. That is different from edge % (price value). Not betting advice.
        </p>
      </footer>
    </main>
  );
}
