import { Suspense } from "react";
import { LoginView } from "@/components/LoginView";

export default function LoginPage() {
  return (
    <main className="shell login-page">
      <Suspense
        fallback={
          <div className="login-shell">
            <div className="atmosphere" aria-hidden />
            <p className="muted" style={{ position: "relative", zIndex: 1 }}>
              Loading…
            </p>
          </div>
        }
      >
        <LoginView />
      </Suspense>
    </main>
  );
}
