import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <Dashboard />
    </main>
  );
}
