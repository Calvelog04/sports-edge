"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
  billing: {
    ready: boolean;
    provider: string;
    venmoConfigured: boolean;
    venmoBusinessUsername: string;
    venmoDisplayName: string;
    venmoPayUrl: string | null;
  };
};

function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function AccountView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<AccountPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [interval, setInterval] = useState<"month" | "year">("month");
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

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    const sessionId = searchParams.get("session_id");
    if (checkout === "cancel") {
      setNotice("Checkout canceled — no charge was made.");
      return;
    }
    if (checkout === "success" && sessionId) {
      startTransition(async () => {
        setError(null);
        try {
          const res = await fetch(
            `/api/billing/success?session_id=${encodeURIComponent(sessionId)}`,
            { cache: "no-store" },
          );
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? "Could not confirm payment");
          setNotice("Payment received — unlocking Pro…");
          router.replace("/");
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Payment confirmation failed");
        }
      });
    }
  }, [searchParams, router]);

  function payWithCard() {
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not start card checkout");
        if (!body.url) throw new Error("No checkout URL returned");
        window.location.href = body.url as string;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Checkout failed");
      }
    });
  }

  function payWithVenmo() {
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/billing/venmo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Venmo setup failed");
        setNotice(
          "Venmo opened. After you pay, Management will confirm and unlock Pro.",
        );
        if (body.payUrl) window.open(body.payUrl as string, "_blank", "noopener,noreferrer");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Venmo failed");
      }
    });
  }

  const pro = data?.proPlan;
  const amountCents =
    interval === "year"
      ? (pro?.priceAnnualCents ?? 20000)
      : (pro?.priceMonthlyCents ?? 2000);
  const price = pro ? money(amountCents, pro.currency) : "$20.00";
  const billing = data?.billing;

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
      {notice && (
        <div className="status-banner live">
          <span className="meta">{notice}</span>
        </div>
      )}

      <section className="info-block account-paywall">
        <h2 className="info-title">Unlock betting boards</h2>
        <p className="info-copy">
          Pay with debit/credit card (Stripe) or send payment to the business Venmo.
          Boards unlock after a successful card payment, or after Management confirms
          Venmo.
        </p>
        {pro && (
          <ul className="rationale">
            {pro.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}

        <div className="account-interval">
          <button
            type="button"
            className={interval === "month" ? "timing-chip active" : "timing-chip"}
            onClick={() => setInterval("month")}
          >
            Monthly · {pro ? money(pro.priceMonthlyCents, pro.currency) : "$20"}
          </button>
          <button
            type="button"
            className={interval === "year" ? "timing-chip active" : "timing-chip"}
            onClick={() => setInterval("year")}
          >
            Annual · {pro ? money(pro.priceAnnualCents, pro.currency) : "$200"}
          </button>
        </div>

        <p className="info-copy">
          <strong>
            {pro?.name ?? "Pro"} — {price}
            {interval === "year" ? "/year" : "/month"}
          </strong>
        </p>

        <button
          type="button"
          className="login-submit"
          disabled={pending || billing?.ready === false}
          onClick={payWithCard}
        >
          {pending
            ? "Redirecting…"
            : billing?.ready === false
              ? "Card checkout not configured yet"
              : `Pay ${price} with debit / credit card`}
        </button>

        {billing?.venmoConfigured && (
          <>
            <p className="info-copy account-or">or</p>
            <button
              type="button"
              className="login-submit secondary"
              disabled={pending}
              onClick={payWithVenmo}
            >
              Pay {price} via Venmo
              {billing.venmoBusinessUsername
                ? ` (@${billing.venmoBusinessUsername})`
                : ""}
            </button>
            <p className="signal-meta">
              Sends to{" "}
              {billing.venmoDisplayName || `@${billing.venmoBusinessUsername}`} —
              include your account email in the Venmo note.
            </p>
          </>
        )}

        {!billing?.ready && (
          <p className="signal-meta">
            Card payments need Stripe keys in Management → Payments (or{" "}
            <code>.env.local</code>).
          </p>
        )}
      </section>
    </div>
  );
}
