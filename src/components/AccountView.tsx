"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AccountPayload = {
  user: {
    id: string;
    email: string;
    name: string;
    plan: string;
    status: string;
    paid: boolean;
  };
  proPlan: {
    id: string;
    name: string;
    priceMonthlyCents: number;
    priceAnnualCents: number;
    features: string[];
    currency: string;
  } | null;
};

function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function AccountView() {
  const router = useRouter();
  const [data, setData] = useState<AccountPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/account", { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Could not load account");
        }
        const json = (await res.json()) as AccountPayload;
        setData(json);
        if (json.user.paid) {
          router.replace("/");
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
      }
    });
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  function pay() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/account", { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Payment failed");
        router.replace("/");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Payment failed");
      }
    });
  }

  const pro = data?.proPlan;
  const price = pro ? money(pro.priceMonthlyCents, pro.currency) : "$20.00";

  return (
    <div className="dashboard manage-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Account — payment required</p>
        </div>
        <div className="header-controls">
          <form method="POST" action="/api/auth/logout">
            <input type="hidden" name="scope" value="user" />
            <button type="submit" className="refresh-btn">
              Log out
            </button>
          </form>
        </div>
      </header>

      <div className="status-banner live">
        <div>
          <span className="mode-pill">ACCOUNT</span>
          <span className="meta">
            {data
              ? `${data.user.email} · ${data.user.plan} plan · betting boards locked`
              : "Loading…"}
          </span>
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <section className="info-block account-paywall">
        <h2 className="info-title">Unlock betting boards</h2>
        <p className="info-copy">
          User accounts cannot view odds, edges, props, or picks until Pro is paid. No betting
          information is shown on this page.
        </p>
        {pro && (
          <ul className="rationale">
            {pro.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <p className="info-copy">
          <strong>
            {pro?.name ?? "Pro"} — {price}/month
          </strong>
        </p>
        <button type="button" className="login-submit" disabled={pending} onClick={pay}>
          {pending ? "Processing…" : `Pay ${price} — unlock Pro`}
        </button>
      </section>
    </div>
  );
}
