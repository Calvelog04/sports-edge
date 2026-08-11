import { CalendarView } from "@/components/CalendarView";

export default function CalendarPage() {
  return (
    <main className="shell shell-wide">
      <div className="atmosphere" aria-hidden />
      <CalendarView />
      <footer className="site-footer">
        <p>
          Calendar ranks games by model edge vs best sportsbook price. Month and week views
          use the same FanDuel-inclusive odds feed.
        </p>
      </footer>
    </main>
  );
}
