"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { ManagedUser, UserPlan, UserRole, UserStatus } from "@/lib/users";
import type { PaymentEvent, PaymentPlan, PaymentSettingsPublic } from "@/lib/payments";

type Tab = "users" | "payments";

function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function ManagementView() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    disabled: number;
    admins: number;
    pro: number;
    free: number;
  } | null>(null);
  const [settings, setSettings] = useState<PaymentSettingsPublic | null>(null);
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("member");
  const [newPlan, setNewPlan] = useState<UserPlan>("free");

  const [pubKey, setPubKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [provider, setProvider] = useState<"none" | "stripe">("none");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [currency, setCurrency] = useState("usd");
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [manualEmail, setManualEmail] = useState("");
  const [manualPlanId, setManualPlanId] = useState("pro");
  const [manualAmount, setManualAmount] = useState("20");

  const load = useCallback(() => {
    startTransition(async () => {
      setError(null);
      try {
        const [uRes, pRes] = await Promise.all([
          fetch("/api/management/users", { cache: "no-store" }),
          fetch("/api/management/payments", { cache: "no-store" }),
        ]);
        if (!uRes.ok) {
          const body = await uRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load users");
        }
        if (!pRes.ok) {
          const body = await pRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load payments");
        }
        const uJson = (await uRes.json()) as {
          users: ManagedUser[];
          stats: typeof stats;
        };
        const pJson = (await pRes.json()) as {
          settings: PaymentSettingsPublic;
          events: PaymentEvent[];
        };
        setUsers(uJson.users);
        setStats(uJson.stats);
        setSettings(pJson.settings);
        setEvents(pJson.events);
        setPubKey(pJson.settings.publishableKey);
        setProvider(pJson.settings.provider);
        setMode(pJson.settings.mode);
        setCurrency(pJson.settings.currency);
        setPlans(pJson.settings.plans);
        setSecretKey("");
        setWebhookSecret("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  }

  function addUser() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/management/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: newEmail,
            name: newName || undefined,
            role: newRole,
            plan: newPlan,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Create failed");
        setNewEmail("");
        setNewName("");
        flash("User added");
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Create failed");
      }
    });
  }

  function patchUser(id: string, patch: Record<string, string>) {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/management/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...patch }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Update failed");
        flash("User updated");
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  function removeUser(id: string) {
    if (!confirm("Delete this user?")) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/management/users?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Delete failed");
        flash("User deleted");
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    });
  }

  function savePayments() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/management/payments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            mode,
            currency,
            publishableKey: pubKey,
            secretKey: secretKey || undefined,
            webhookSecret: webhookSecret || undefined,
            plans,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Save failed");
        flash("Payment settings saved");
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function recordManualPayment() {
    startTransition(async () => {
      setError(null);
      try {
        const dollars = Number(manualAmount);
        const res = await fetch("/api/management/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: manualEmail,
            planId: manualPlanId,
            amountCents: Math.round((Number.isFinite(dollars) ? dollars : 0) * 100),
            currency,
            status: "paid",
            note: "Manual payment recorded in Management",
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Record failed");
        setManualEmail("");
        flash("Payment recorded");
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Record failed");
      }
    });
  }

  function updatePlan(id: string, patch: Partial<PaymentPlan>) {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  return (
    <div className="dashboard manage-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Management</p>
        </div>
        <div className="header-controls">
          <button type="button" className="refresh-btn" onClick={load} disabled={pending}>
            {pending ? "Loading…" : "Refresh"}
          </button>
          <form method="POST" action="/api/auth/logout">
            <input type="hidden" name="scope" value="mgmt" />
            <button type="submit" className="refresh-btn">
              Log out
            </button>
          </form>
        </div>
      </header>

      <div className="status-banner live">
        <div>
          <span className="mode-pill">MANAGE</span>
          <span className="meta">
            {stats
              ? `${stats.total} users · ${stats.active} active · ${stats.pro} pro · payments ${
                  settings?.ready ? "ready" : "not ready"
                }`
              : "Loading…"}
          </span>
        </div>
      </div>

      <div className="timing-switch" role="tablist" aria-label="Management sections">
        <button
          type="button"
          className={tab === "users" ? "timing-chip active" : "timing-chip"}
          onClick={() => setTab("users")}
        >
          Users
        </button>
        <button
          type="button"
          className={tab === "payments" ? "timing-chip active" : "timing-chip"}
          onClick={() => setTab("payments")}
        >
          Payments
        </button>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {notice && <p className="save-pick-msg">{notice}</p>}

      {tab === "users" && (
        <div className="manage-grid">
          <section className="info-block">
            <h2 className="info-title">Add user</h2>
            <div className="manage-form">
              <label className="login-label" htmlFor="m-email">
                Email
              </label>
              <input
                id="m-email"
                className="login-input"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="name@example.com"
              />
              <label className="login-label" htmlFor="m-name">
                Name
              </label>
              <input
                id="m-name"
                className="login-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Display name"
              />
              <div className="manage-row">
                <label className="login-label">
                  Role
                  <select
                    className="login-input"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label className="login-label">
                  Plan
                  <select
                    className="login-input"
                    value={newPlan}
                    onChange={(e) => setNewPlan(e.target.value as UserPlan)}
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="login-submit"
                disabled={pending || !newEmail.includes("@")}
                onClick={addUser}
              >
                Add user
              </button>
            </div>
          </section>

          <section className="info-block manage-wide">
            <h2 className="info-title">All users</h2>
            <div className="manage-table-wrap">
              <table className="manage-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                        <div className="signal-meta">{u.email}</div>
                      </td>
                      <td>
                        <select
                          className="manage-select"
                          value={u.role}
                          onChange={(e) =>
                            patchUser(u.id, { role: e.target.value as UserRole })
                          }
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="manage-select"
                          value={u.plan}
                          onChange={(e) =>
                            patchUser(u.id, { plan: e.target.value as UserPlan })
                          }
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="manage-select"
                          value={u.status}
                          onChange={(e) =>
                            patchUser(u.id, { status: e.target.value as UserStatus })
                          }
                        >
                          <option value="active">Active</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </td>
                      <td className="signal-meta">
                        {u.lastLoginAt
                          ? new Date(u.lastLoginAt).toLocaleString()
                          : "Never"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="manage-danger"
                          onClick={() => removeUser(u.id)}
                          disabled={pending}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No users yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "payments" && settings && (
        <div className="manage-grid">
          <section className="info-block">
            <h2 className="info-title">Payment center</h2>
            <p className="info-copy">
              Configure Stripe (or leave provider off). Keys stay on this machine under{" "}
              <code>data/payments.json</code>. Live checkout can be wired once keys are set.
            </p>
            <div className="manage-form">
              <label className="login-label">
                Provider
                <select
                  className="login-input"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as "none" | "stripe")}
                >
                  <option value="none">None (manual only)</option>
                  <option value="stripe">Stripe</option>
                </select>
              </label>
              <label className="login-label">
                Mode
                <select
                  className="login-input"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "test" | "live")}
                >
                  <option value="test">Test</option>
                  <option value="live">Live</option>
                </select>
              </label>
              <label className="login-label">
                Currency
                <input
                  className="login-input"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                />
              </label>
              <label className="login-label">
                Publishable key
                <input
                  className="login-input"
                  value={pubKey}
                  onChange={(e) => setPubKey(e.target.value)}
                  placeholder="pk_test_…"
                  autoComplete="off"
                />
              </label>
              <label className="login-label">
                Secret key {settings.secretKeySet ? `(saved ${settings.secretKeyMasked})` : ""}
                <input
                  className="login-input"
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={settings.secretKeySet ? "Leave blank to keep current" : "sk_test_…"}
                  autoComplete="off"
                />
              </label>
              <label className="login-label">
                Webhook secret{" "}
                {settings.webhookSecretSet ? `(saved ${settings.webhookSecretMasked})` : ""}
                <input
                  className="login-input"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={
                    settings.webhookSecretSet ? "Leave blank to keep current" : "whsec_…"
                  }
                  autoComplete="off"
                />
              </label>
              <p className="signal-meta">
                Status:{" "}
                {settings.ready
                  ? "Ready for Stripe checkout wiring"
                  : "Not ready — set provider to Stripe and add keys + a paid plan"}
              </p>
              <button type="button" className="login-submit" disabled={pending} onClick={savePayments}>
                Save payment settings
              </button>
            </div>
          </section>

          <section className="info-block">
            <h2 className="info-title">Plans</h2>
            {plans.map((plan) => (
              <div key={plan.id} className="manage-plan">
                <strong>{plan.name}</strong>
                <div className="manage-row">
                  <label className="login-label">
                    Monthly ($)
                    <input
                      className="login-input"
                      type="number"
                      min={0}
                      step={1}
                      value={(plan.priceMonthlyCents / 100).toString()}
                      onChange={(e) =>
                        updatePlan(plan.id, {
                          priceMonthlyCents: Math.round(Number(e.target.value || 0) * 100),
                        })
                      }
                    />
                  </label>
                  <label className="login-label">
                    Annual ($)
                    <input
                      className="login-input"
                      type="number"
                      min={0}
                      step={1}
                      value={(plan.priceAnnualCents / 100).toString()}
                      onChange={(e) =>
                        updatePlan(plan.id, {
                          priceAnnualCents: Math.round(Number(e.target.value || 0) * 100),
                        })
                      }
                    />
                  </label>
                </div>
                <label className="manage-check">
                  <input
                    type="checkbox"
                    checked={plan.active}
                    onChange={(e) => updatePlan(plan.id, { active: e.target.checked })}
                  />
                  Active
                </label>
                <p className="signal-meta">{plan.features.join(" · ")}</p>
              </div>
            ))}
            <button type="button" className="refresh-btn" disabled={pending} onClick={savePayments}>
              Save plan prices
            </button>
          </section>

          <section className="info-block">
            <h2 className="info-title">Record payment</h2>
            <p className="info-copy">
              Log a manual payment until Stripe Checkout / webhooks are connected.
            </p>
            <div className="manage-form">
              <label className="login-label">
                Customer email
                <input
                  className="login-input"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="customer@example.com"
                />
              </label>
              <div className="manage-row">
                <label className="login-label">
                  Plan
                  <select
                    className="login-input"
                    value={manualPlanId}
                    onChange={(e) => setManualPlanId(e.target.value)}
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="login-label">
                  Amount ($)
                  <input
                    className="login-input"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="login-submit"
                disabled={pending || !manualEmail.includes("@")}
                onClick={recordManualPayment}
              >
                Record paid
              </button>
            </div>
          </section>

          <section className="info-block manage-wide">
            <h2 className="info-title">Payment activity</h2>
            <div className="manage-table-wrap">
              <table className="manage-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Email</th>
                    <th>Plan</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td className="signal-meta">
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td>{ev.email}</td>
                      <td>{ev.planId}</td>
                      <td>{money(ev.amountCents, ev.currency)}</td>
                      <td>{ev.status}</td>
                      <td className="signal-meta">{ev.note}</td>
                    </tr>
                  ))}
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No payment events yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
