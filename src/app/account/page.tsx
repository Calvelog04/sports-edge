import { Suspense } from "react";
import { AccountView } from "@/components/AccountView";

export default function AccountPage() {
  return (
    <main className="shell">
      <div className="atmosphere" aria-hidden />
      <Suspense fallback={<p className="info-copy">Loading account…</p>}>
        <AccountView />
      </Suspense>
    </main>
  );
}
