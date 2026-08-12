import { PerformanceView } from "@/components/PerformanceView";

export default function PerformancePage() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <PerformanceView />
    </main>
  );
}
